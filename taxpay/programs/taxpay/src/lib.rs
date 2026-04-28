use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("2kBACGEWnZHaiLPySUCudChBKRc57L49PVaCotGZrbyk");

// ─────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────
/// Maximum tax rate: 100% (in basis points, 10_000 = 100%)
const MAX_TAX_BPS: u64 = 10_000;
/// Minimum lamports required to keep an account rent-exempt (buffer)
const LAMPORT_BUFFER: u64 = 890_880;

// ─────────────────────────────────────────────────────────────
//  PROGRAM
// ─────────────────────────────────────────────────────────────
#[program]
pub mod taxpay {
    use super::*;

    /// Initialize a business registry account.
    /// Every business must call this once before accepting payments.
    pub fn initialize_business(
        ctx: Context<InitializeBusiness>,
        business_name: String,
        tax_rate_bps: u64, // e.g. 1300 = 13%
    ) -> Result<()> {
        require!(tax_rate_bps <= MAX_TAX_BPS, TaxPayError::InvalidTaxRate);
        require!(business_name.len() <= 64, TaxPayError::NameTooLong);

        let business = &mut ctx.accounts.business_account;
        business.owner = ctx.accounts.owner.key();
        business.government_wallet = ctx.accounts.government_wallet.key();
        business.name = business_name;
        business.tax_rate_bps = tax_rate_bps;
        business.total_revenue = 0;
        business.total_tax_collected = 0;
        business.transaction_count = 0;
        business.bump = ctx.bumps.business_account;

        emit!(BusinessInitialized {
            owner: business.owner,
            government_wallet: business.government_wallet,
            name: business.name.clone(),
            tax_rate_bps,
        });

        Ok(())
    }

    /// Core payment instruction.
    /// Payer sends `total_lamports` which is split automatically:
    ///   - tax portion  → government_wallet
    ///   - net portion  → business owner wallet
    ///   - a TaxRecord PDA is created to permanently log this transaction
    pub fn pay_with_tax(
        ctx: Context<PayWithTax>,
        total_lamports: u64,
        invoice_ipfs_hash: String, // optional IPFS CID, pass "" if unused
        product_name: String,
    ) -> Result<()> {
        require!(total_lamports > 0, TaxPayError::ZeroAmount);
        require!(invoice_ipfs_hash.len() <= 64, TaxPayError::HashTooLong);
        require!(product_name.len() <= 64, TaxPayError::NameTooLong);

        let business = &ctx.accounts.business_account;
        let tax_rate_bps = business.tax_rate_bps;

        // ── Split calculation ──────────────────────────────────
        // tax_amount = total * tax_rate / (10000 + tax_rate)
        // This formula treats `total_lamports` as the INCLUSIVE total
        // e.g. 1130 lamports at 13% → tax = 130, net = 1000
        let tax_amount = total_lamports
            .checked_mul(tax_rate_bps)
            .ok_or(TaxPayError::MathOverflow)?
            .checked_div(MAX_TAX_BPS.checked_add(tax_rate_bps).ok_or(TaxPayError::MathOverflow)?)
            .ok_or(TaxPayError::MathOverflow)?;

        let net_amount = total_lamports
            .checked_sub(tax_amount)
            .ok_or(TaxPayError::MathOverflow)?;

        // ── Safety checks ──────────────────────────────────────
        require!(
            ctx.accounts.payer.lamports() >= total_lamports.checked_add(LAMPORT_BUFFER).unwrap_or(u64::MAX),
            TaxPayError::InsufficientFunds
        );

        // ── Transfer tax → government wallet ──────────────────
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.government_wallet.to_account_info(),
                },
            ),
            tax_amount,
        )?;

        // ── Transfer net → business owner wallet ──────────────
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.business_owner.to_account_info(),
                },
            ),
            net_amount,
        )?;

        // ── Update business stats ──────────────────────────────
        let business_mut = &mut ctx.accounts.business_account;
        business_mut.total_revenue = business_mut
            .total_revenue
            .checked_add(net_amount)
            .ok_or(TaxPayError::MathOverflow)?;
        business_mut.total_tax_collected = business_mut
            .total_tax_collected
            .checked_add(tax_amount)
            .ok_or(TaxPayError::MathOverflow)?;
        business_mut.transaction_count = business_mut
            .transaction_count
            .checked_add(1)
            .ok_or(TaxPayError::MathOverflow)?;

        // ── Write immutable TaxRecord ─────────────────────────
        let record = &mut ctx.accounts.tax_record;
        record.business = business_mut.key();
        record.payer = ctx.accounts.payer.key();
        record.business_owner = ctx.accounts.business_owner.key();
        record.government_wallet = ctx.accounts.government_wallet.key();
        record.total_amount = total_lamports;
        record.tax_amount = tax_amount;
        record.net_amount = net_amount;
        record.tax_rate_bps = tax_rate_bps;
        record.product_name = product_name.clone();
        record.invoice_ipfs_hash = invoice_ipfs_hash.clone();
        record.timestamp = Clock::get()?.unix_timestamp;
        record.transaction_index = business_mut.transaction_count;
        record.bump = ctx.bumps.tax_record;

        emit!(PaymentProcessed {
            business: business_mut.key(),
            payer: ctx.accounts.payer.key(),
            total_amount: total_lamports,
            tax_amount,
            net_amount,
            tax_rate_bps,
            product_name,
            invoice_ipfs_hash,
            timestamp: record.timestamp,
        });

        Ok(())
    }

    /// Update tax rate (only business owner can call)
    pub fn update_tax_rate(
        ctx: Context<UpdateBusiness>,
        new_tax_rate_bps: u64,
    ) -> Result<()> {
        require!(new_tax_rate_bps <= MAX_TAX_BPS, TaxPayError::InvalidTaxRate);
        ctx.accounts.business_account.tax_rate_bps = new_tax_rate_bps;
        Ok(())
    }

    /// Update government wallet (only business owner can call)
    pub fn update_government_wallet(
        ctx: Context<UpdateBusiness>,
        new_government_wallet: Pubkey,
    ) -> Result<()> {
        ctx.accounts.business_account.government_wallet = new_government_wallet;
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────
//  ACCOUNTS
// ─────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(business_name: String, tax_rate_bps: u64)]
pub struct InitializeBusiness<'info> {
    #[account(
        init,
        payer = owner,                                    // FIX 1: owner must be mut (see below)
        space = BusinessAccount::LEN,
        seeds = [b"business", owner.key().as_ref()],
        bump
    )]
    pub business_account: Account<'info, BusinessAccount>,

    // FIX 2: removed the stray `business: Account<'info, Business>` field —
    //         it referenced a non-existent type and broke Bumps derivation.

    #[account(mut)]                                       // FIX 3: payer must be `mut`
    pub owner: Signer<'info>,

    /// CHECK: This is the government/tax authority wallet address — not a program account
    pub government_wallet: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(total_lamports: u64, invoice_ipfs_hash: String, product_name: String)]
pub struct PayWithTax<'info> {
    #[account(
        mut,
        seeds = [b"business", business_owner.key().as_ref()],
        bump = business_account.bump,
        has_one = government_wallet,
        has_one = owner @ TaxPayError::NotBusinessOwner,  // FIX 4: `owner` field added below
    )]
    pub business_account: Account<'info, BusinessAccount>,

    /// The unique PDA for this specific transaction record
    #[account(
        init,
        payer = payer,
        space = TaxRecord::LEN,
        seeds = [
            b"tax_record",
            business_account.key().as_ref(),
            &business_account.transaction_count.to_le_bytes(),
        ],
        bump
    )]
    pub tax_record: Account<'info, TaxRecord>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Business owner wallet — receives net payment
    #[account(mut, address = business_account.owner)]
    pub business_owner: AccountInfo<'info>,

    // FIX 4: `has_one = owner` requires an `owner` field in this struct.
    // We expose it as a read-only Signer so the constraint resolves correctly.
    pub owner: Signer<'info>,

    /// CHECK: Government wallet — receives tax
    #[account(mut, address = business_account.government_wallet)]
    pub government_wallet: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateBusiness<'info> {
    #[account(
        mut,
        seeds = [b"business", owner.key().as_ref()],
        bump = business_account.bump,
        has_one = owner @ TaxPayError::NotBusinessOwner,
    )]
    pub business_account: Account<'info, BusinessAccount>,

    pub owner: Signer<'info>,
}

// ─────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────

#[account]
pub struct BusinessAccount {
    pub owner: Pubkey,            // 32
    pub government_wallet: Pubkey,// 32
    pub name: String,             // 4 + 64
    pub tax_rate_bps: u64,        // 8
    pub total_revenue: u64,       // 8
    pub total_tax_collected: u64, // 8
    pub transaction_count: u64,   // 8
    pub bump: u8,                 // 1
}

impl BusinessAccount {
    pub const LEN: usize = 8    // discriminator
        + 32                    // owner
        + 32                    // government_wallet
        + 4 + 64                // name (String)
        + 8                     // tax_rate_bps
        + 8                     // total_revenue
        + 8                     // total_tax_collected
        + 8                     // transaction_count
        + 1;                    // bump
}

#[account]
pub struct TaxRecord {
    pub business: Pubkey,          // 32
    pub payer: Pubkey,             // 32
    pub business_owner: Pubkey,    // 32
    pub government_wallet: Pubkey, // 32
    pub total_amount: u64,         // 8
    pub tax_amount: u64,           // 8
    pub net_amount: u64,           // 8
    pub tax_rate_bps: u64,         // 8
    pub product_name: String,      // 4 + 64
    pub invoice_ipfs_hash: String, // 4 + 64
    pub timestamp: i64,            // 8
    pub transaction_index: u64,    // 8
    pub bump: u8,                  // 1
}

impl TaxRecord {
    pub const LEN: usize = 8    // discriminator
        + 32                    // business
        + 32                    // payer
        + 32                    // business_owner
        + 32                    // government_wallet
        + 8                     // total_amount
        + 8                     // tax_amount
        + 8                     // net_amount
        + 8                     // tax_rate_bps
        + 4 + 64                // product_name
        + 4 + 64                // invoice_ipfs_hash
        + 8                     // timestamp
        + 8                     // transaction_index
        + 1;                    // bump
}

// ─────────────────────────────────────────────────────────────
//  EVENTS
// ─────────────────────────────────────────────────────────────

#[event]
pub struct BusinessInitialized {
    pub owner: Pubkey,
    pub government_wallet: Pubkey,
    pub name: String,
    pub tax_rate_bps: u64,
}

#[event]
pub struct PaymentProcessed {
    pub business: Pubkey,
    pub payer: Pubkey,
    pub total_amount: u64,
    pub tax_amount: u64,
    pub net_amount: u64,
    pub tax_rate_bps: u64,
    pub product_name: String,
    pub invoice_ipfs_hash: String,
    pub timestamp: i64,
}

// ─────────────────────────────────────────────────────────────
//  ERRORS
// ─────────────────────────────────────────────────────────────

#[error_code]
pub enum TaxPayError {
    #[msg("Tax rate cannot exceed 100% (10000 bps)")]
    InvalidTaxRate,
    #[msg("Payment amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Insufficient funds to complete payment")]
    InsufficientFunds,
    #[msg("Only the business owner can perform this action")]
    NotBusinessOwner,
    #[msg("Business name must be 64 characters or less")]
    NameTooLong,
    #[msg("IPFS hash must be 64 characters or less")]
    HashTooLong,
}