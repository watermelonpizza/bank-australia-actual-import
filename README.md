# Bank Australia Actual Transaction Importer

This nodejs script will import your transactions from Bank Australias csv file (exported from the app) into an actual instance of your choosing.

## Usage
```
Usage: index [options]

Options:
  -u, --url <url>                              Actual URL
  -p, --password <password>                    Actual password
  -b, --sync-id <syncId>                       Actual Sync ID (found in settings > Advanced Settings)
  -m, --account-mapping <account-mappings...>  Account mapping in the format: bank-account-id=actual-account-id
  -f, --file <files...>                        File to import
  -h, --help                                   display help for command
```

## Notes
- Actual is smart enough not to duplicate transactions. If you run the script multiple times, it should only import new transactions. Although there is no guarantee that it will work perfectly, this script is relying on actual to do the right thing.
- The script will not delete and shouldn't be relied on to update transactions from actual. If you delete or update a transaction from the csv file and run the script, the transaction will not be deleted and might not be updated in actual. It's purely to import transactions. Once you import transactions it's best to no-longer use the date range if possible for whatever account you imported into. Any edits or deletions you wish to make should be done in actual.
- Transfer transactions (between your accounts not externally) are *only* performed if there is a transfer *to* one account to another!
    - If you have a transfer from say, a savings account to a credit card, the transfer will not show up if you only import the credit card transaction history. You will need to import the savings account transaction history as well.

## Bank Australia csv transactions
The csv file is exported from the Bank Australia app. You cannot (as of June 2023) export transactions from the website as they don't have the transaction merchant details which are required for the import.

To download a transaction history to import:
1. Open the Bank Australia app
2. Click on the account you want to export transactions for
3. Click on the ... icon in the top right
4. Click "Download transaction history"
5. Select the date range you want to export

## Actual account mapping
The account mapping is used to map the bank account id from the csv file to the actual account id. The bank account id is the account number in the csv file. The actual account id is the id of the account in actual. You can get this by going to the account in actual and looking at the url. The id is the last part of the url. For example, if the url is `https://my-actual-instance.com/accounts/12345678-1234-1234-1234-123456789012` then the account id is `12345678-1234-1234-1234-123456789012`.

### Example
```
node index.js \
  --url https://my-actual-instance.com \
  --password password \
  --sync-id 12345678-1234-1234-1234-123456789012 \
  --account-mapping 12345678=12345678-1234-1234-1234-123456789012 \
  --file "Bank Australia Transaction History 2021-01-01 to 2021-12-31.csv"
```
