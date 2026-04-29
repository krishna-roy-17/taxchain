/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/taxpay.json`.
 */
export type Taxpay = {
  "address": "2kBACGEWnZHaiLPySUCudChBKRc57L49PVaCotGZrbyk",
  "metadata": {
    "name": "taxpay",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "initializeBusiness",
      "docs": [
        "Initialize a business registry account.",
        "Every business must call this once before accepting payments."
      ],
      "discriminator": [
        224,
        230,
        190,
        93,
        141,
        151,
        35,
        237
      ],
      "accounts": [
        {
          "name": "businessAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  115,
                  105,
                  110,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "governmentWallet"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "businessName",
          "type": "string"
        },
        {
          "name": "taxRateBps",
          "type": "u64"
        }
      ]
    },
    {
      "name": "payWithTax",
      "docs": [
        "Core payment instruction.",
        "Payer sends `total_lamports` which is split automatically:",
        "- tax portion  → government_wallet",
        "- net portion  → business owner wallet",
        "- a TaxRecord PDA is created to permanently log this transaction"
      ],
      "discriminator": [
        193,
        73,
        76,
        218,
        35,
        17,
        249,
        128
      ],
      "accounts": [
        {
          "name": "businessAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  115,
                  105,
                  110,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "businessOwner"
              }
            ]
          }
        },
        {
          "name": "taxRecord",
          "docs": [
            "The unique PDA for this specific transaction record"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  120,
                  95,
                  114,
                  101,
                  99,
                  111,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "businessAccount"
              },
              {
                "kind": "account",
                "path": "business_account.transaction_count",
                "account": "businessAccount"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "businessOwner",
          "writable": true
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "businessAccount"
          ]
        },
        {
          "name": "governmentWallet",
          "writable": true,
          "relations": [
            "businessAccount"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "totalLamports",
          "type": "u64"
        },
        {
          "name": "invoiceIpfsHash",
          "type": "string"
        },
        {
          "name": "productName",
          "type": "string"
        }
      ]
    },
    {
      "name": "updateGovernmentWallet",
      "docs": [
        "Update government wallet (only business owner can call)"
      ],
      "discriminator": [
        253,
        30,
        112,
        71,
        66,
        232,
        39,
        4
      ],
      "accounts": [
        {
          "name": "businessAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  115,
                  105,
                  110,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "businessAccount"
          ]
        }
      ],
      "args": [
        {
          "name": "newGovernmentWallet",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateTaxRate",
      "docs": [
        "Update tax rate (only business owner can call)"
      ],
      "discriminator": [
        203,
        159,
        87,
        153,
        34,
        252,
        166,
        170
      ],
      "accounts": [
        {
          "name": "businessAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  115,
                  105,
                  110,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "businessAccount"
          ]
        }
      ],
      "args": [
        {
          "name": "newTaxRateBps",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "businessAccount",
      "discriminator": [
        100,
        69,
        101,
        155,
        14,
        22,
        236,
        75
      ]
    },
    {
      "name": "taxRecord",
      "discriminator": [
        4,
        103,
        197,
        222,
        200,
        0,
        5,
        198
      ]
    }
  ],
  "events": [
    {
      "name": "businessInitialized",
      "discriminator": [
        165,
        8,
        188,
        170,
        84,
        188,
        149,
        113
      ]
    },
    {
      "name": "paymentProcessed",
      "discriminator": [
        22,
        109,
        191,
        213,
        83,
        63,
        120,
        219
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidTaxRate",
      "msg": "Tax rate cannot exceed 100% (10000 bps)"
    },
    {
      "code": 6001,
      "name": "zeroAmount",
      "msg": "Payment amount must be greater than zero"
    },
    {
      "code": 6002,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6003,
      "name": "insufficientFunds",
      "msg": "Insufficient funds to complete payment"
    },
    {
      "code": 6004,
      "name": "notBusinessOwner",
      "msg": "Only the business owner can perform this action"
    },
    {
      "code": 6005,
      "name": "nameTooLong",
      "msg": "Business name must be 64 characters or less"
    },
    {
      "code": 6006,
      "name": "hashTooLong",
      "msg": "IPFS hash must be 64 characters or less"
    }
  ],
  "types": [
    {
      "name": "businessAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "governmentWallet",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "taxRateBps",
            "type": "u64"
          },
          {
            "name": "totalRevenue",
            "type": "u64"
          },
          {
            "name": "totalTaxCollected",
            "type": "u64"
          },
          {
            "name": "transactionCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "businessInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "governmentWallet",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "taxRateBps",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "paymentProcessed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "business",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "totalAmount",
            "type": "u64"
          },
          {
            "name": "taxAmount",
            "type": "u64"
          },
          {
            "name": "netAmount",
            "type": "u64"
          },
          {
            "name": "taxRateBps",
            "type": "u64"
          },
          {
            "name": "productName",
            "type": "string"
          },
          {
            "name": "invoiceIpfsHash",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "taxRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "business",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "businessOwner",
            "type": "pubkey"
          },
          {
            "name": "governmentWallet",
            "type": "pubkey"
          },
          {
            "name": "totalAmount",
            "type": "u64"
          },
          {
            "name": "taxAmount",
            "type": "u64"
          },
          {
            "name": "netAmount",
            "type": "u64"
          },
          {
            "name": "taxRateBps",
            "type": "u64"
          },
          {
            "name": "productName",
            "type": "string"
          },
          {
            "name": "invoiceIpfsHash",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "transactionIndex",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
