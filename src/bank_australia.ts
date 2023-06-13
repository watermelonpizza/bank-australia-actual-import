import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';
import { Actual, ITransaction } from './actual';
import { utils } from '@actual-app/api';
import { extractDate, toTitleCase } from './utils';
import { UUID } from 'crypto';

export enum TransactionType {
  ALL = 'ALL',
  ALL_WDLS = 'ALL WDLS',
  ALL_DEPOSITS = 'ALL DEPOSITS',
  BPAY = 'BPAY',
  VISA = 'VISA'
}

export interface CSVDataRow {
  'Account number': string;
  'Transaction type': TransactionType;
  'Effective date': string;
  'Create date': string;
  'Reference no': string;
  'Debit amount': string;
  'Credit amount': string;
  'Balance after transfer': string;
  Description: string;
  'Long description': string;
  'Cheque number': string;
  'Merchant name': string;
  'Category list': string;
}

export class BankAustralia {
  private _actual: Actual;
  private _idMapping: Map<string, UUID>;

  public static PayeeName: string = 'Bank Australia';

  /**
   * Manual overrides for category mapping to ensure some categories don't get created in the app
   */
  public static CategoryOverrides: { [key: string]: string } = {
    'Liquor Store, Restricted': 'Groceries'
  };

  /**
   * Returns true if the given account id is in the format expected by Bank Australia
   * @param accountId The account id to check
   * @returns {boolean} True if the account id is in the expected format
   * @static
   * @memberof BankAustralia
   * @example BankAustralia.CheckAccountIdFormat('12345678'); // true
   * @example BankAustralia.CheckAccountIdFormat('hello'); // false
   */
  public static CheckAccountIdFormat(accountId: string): boolean {
    if (!accountId) return false;
    return /^\d{8}$/.test(accountId);
  }

  constructor(idMapping: Map<string, UUID>, actual: Actual) {
    this._actual = actual;
    this._idMapping = idMapping;
  }

  /**
   * Reads in a single csv file extracted from the Bank Australia app and imports it into Actual.
   * @param account The account id or name in Actual to import into (NOT the account number from Bank Australia)
   * @param path The path to the CSV file
   * @returns A promise that resolves when the import is complete
   * @throws Error if the CSV file is not in the expected format
   * @throws Error if there was any issue extracting information from a row
   */
  public async importTransactionsAsync(path: string): Promise<void> {
    if (!this._actual.isInitialised) {
      await this._actual.initialiseActualAsync();
    }

    const csv = this.readCsv(path);

    const transactions = [];

    for (const row of csv) {
      const transaction = await this.csvDataRowToTransactionAsync(row);
      if (transaction) {
        transactions.push(transaction);
      }
    }

    const accountGroupedTransactions = transactions.reduce(
      (acc, transaction) => {
        if (!acc[transaction.account]) {
          acc[transaction.account] = [];
        }
        acc[transaction.account].push(transaction);
        return acc;
      },
      {} as { [key: string]: ITransaction[] }
    );

    for (const accountId in accountGroupedTransactions) {
      await this._actual.importTransactionsAsync(
        accountId,
        accountGroupedTransactions[accountId]
      );
    }

    await this._actual.syncActualAsync();
  }

  /**
   * Reads in a CSV file and returns an array of CSVDataRow objects
   *
   * Example CSV data looks like the following:
   * "Account number","Transaction type","Effective date","Create date","Reference no","Debit amount","Credit amount","Balance after transfer","Description","Long description","Cheque number","Merchant name","Category list"
   * "123456789","ALL","12:00am Sat 31 December, 2022","12:00pm Sat 31 December, 2022","","0.0","0.0","-1234.12","Purchase/Base Interest - Period End Balance: $1,111.11","Purchase/Base Interest - Period End Balance: $1,111.11","0","",""
   * "123456789","VISA","12:00am Sat 31 December, 2022","12:00am Sat 31 December, 2022","","10.00","0.0","-1234.12","PURCHASE","VISA-MY SUPERMARKET 12345 SYDNEY AU#000000(Ref.1111111111) Android Pay","0","My Supermarket (Sydney)","Supermarket, Groceries"
   * "123456789","VISA","12:00am Sat 31 December, 2022","12:00am Sat 31 December, 2022","","10.00","0.0","-1234.12","PURCHASE","VISA-CLOUDFLARE HTTPSWWW.CLOUUSFRGN AMT-11.1111111#123455(Ref.0123456789)","0","",""
   * @param path Path to the csv file
   * @returns Array of CSVDataRow objects
   */
  private readCsv(path: string): CSVDataRow[] {
    const data = readFileSync(path);

    const csv: CSVDataRow[] = parse(data, {
      columns: true,
      skip_empty_lines: true
    });

    return csv;
  }

  private async csvDataRowToTransactionAsync(row: CSVDataRow): Promise<ITransaction | undefined> {
    // Grab out common values
    const date = extractDate(row['Effective date']);
    const debit = utils.amountToInteger(parseFloat(row['Debit amount']));
    const credit = utils.amountToInteger(parseFloat(row['Credit amount']));

    // Ignore zero value transactions
    if (debit === 0 && credit === 0) {
      return undefined;
    }

    // Notes should just be a raw dump of a pipe delimited string of the long description, merchant name, and category list
    // for data archival purposes
    const notes = [
      row['Long description'],
      row['Merchant name'],
      row['Category list']
    ].join('|');

    const imported_payee = row['Long description'];

    const account = this._idMapping.get(row['Account number']);
    if (!account) {
      throw new Error(
        `Unable to find account with account number: ${row['Account number']}`
      );
    }

    let transaction: ITransaction | undefined = {
      account,
      date,
      amount: credit - debit,
      notes,
      imported_payee,
      cleared: true,
    };

    try {
      switch (row['Transaction type']) {
        case TransactionType.ALL:
          transaction = await this.parseTransactionTypeAllAsync(row, transaction);
          break;
        case TransactionType.ALL_WDLS:
          transaction = this.parseTransactionTypeAllWdls(row, transaction);
          break;
        case TransactionType.ALL_DEPOSITS:
          transaction = this.parseTransactionTypeAllDeposits(row, transaction);
          break;
        case TransactionType.BPAY:
          transaction = this.parseTransactionTypeBPay(row, transaction);
          break;
        case TransactionType.VISA:
          transaction = await this.parseTransactionTypeVisaAsync(row, transaction);
          break;
        default:
          throw new Error(`Unknown transaction type: ${row['Transaction type']}`);
      }
    } catch (e) {
      console.error("There was an exception parsing the following transaction (row, transaction (partial))", row, transaction);
      throw e;
    }

    return transaction;
  }

  /**
   * Parse the 'ALL' transaction type
   * @param row The CSV row to parse
   * @param transaction The base transaction object to add to
   * @returns The transaction object with the parsed values added, or undefined if the transaction should be ignored
   * @throws Error if the transaction information cannot be parsed or is unhandled
   */
  private async parseTransactionTypeAllAsync(row: CSVDataRow, transaction: ITransaction): Promise<ITransaction | undefined> {
    // Only parse transfers *TO* somewhere not *FROM* somewhere otherwise we will get duplicates
    if (row['Description'] === 'Internet Transfer') {
      if (row['Long description'].startsWith('Transfer to ')) {
        // Extract out the bank account number which is being transferred to
        const r = /Transfer to \w+ ([0-9]+)/;
        const matches = r.exec(row['Long description']);
        if (!matches) {
          throw new Error(`Unable to extract bank account number from transfer: ${row['Long description']}`);
        }

        const bankAccountNumber = matches[1];
        // Find the mapped account ID from the bank account number
        const actualAccountId = this._idMapping.get(bankAccountNumber);
        if (!actualAccountId) {
          throw new Error(`Unable to find account with account number: ${bankAccountNumber}`);
        }

        // Find the transfer payee for the account we are transferring to
        const transferPayee = this._actual.payees.find(p => p.transfer_acct === actualAccountId);
        if (!transferPayee) {
          throw new Error(`Unable to find transfer payee for account: ${actualAccountId}, this should have been created when the account was created`);
        }

        return {
          ...transaction,
          payee: transferPayee.id,
          // There is no unique id/ref number for transfers but actual doesn't duplicate thankfully if re-run
        };
      } else if (row['Long description'].startsWith("Received from")) {
        // Ignore from transfers
        return undefined;
      }
    } else if (['Interest Credit', 'Credit Card Interest', 'Cash Advance Fee'].includes(row['Long description'])) {
      let category = this._actual.categories.find(c => c.name === 'Interest');
      if (!category) {
        console.info(`Category not found: Interest, creating...`);
        category = await this._actual.createCategoryAsync('Interest');
      }

      return {
        ...transaction,
        payee_name: BankAustralia.PayeeName,
        category: category.id,
      }
    } else if (row['Description'] === 'Internet Ext Transfer') {
      // External transfers to other banks or accounts
      // e.g.
      // Ext TFR - NET# 1234567890 to 5665665 Some Company Name Here ABC - SOME COMPANY NAME HERE -> Payee: Some Company Name Here, Ref: 1234567890
      // Ext TFR - NET# 1234567890 to 3333333 Other Company Name ABC - Location Information -> Payee: Other Company Name, Ref: 1234567890
      const regex = /Ext TFR - NET# (\d+) to \d+ ([A-z\s]+) (?:[A-Z]+) - .*/;
      const matches = regex.exec(row['Long description']);
      if (!matches) {
        throw new Error(`Unable to extract reference and payee details from transfer: ${row['Long description']}`);
      }

      const referenceNumber = matches[1];
      const payeeName = matches[2];

      return {
        ...transaction,
        payee_name: payeeName,
        imported_id: referenceNumber,
      }
    } else if (row['Long description'].startsWith('Net tfr')) {
      if (row['Long description'].startsWith('Net tfr to')) {
        // Handle internet transfers to other accounts, including scheduled transfers
        // e.g.
        // Net tfr to SAV 5555555. Rec No.: 1234567890, Some transaction description
        const regex = /Net tfr to \w+ (\d+)\. Rec No.: (\d+), .*/;
        const matches = regex.exec(row['Long description']);
        if (!matches) {
          throw new Error(`Unable to extract reference and payee details from transfer: ${row['Long description']}`);
        }

        const bankAccountNumber = matches[1];
        const referenceNumber = matches[2];

        // Find the mapped account ID from the bank account number
        const actualAccountId = this._idMapping.get(bankAccountNumber);
        if (!actualAccountId) {
          throw new Error(`Unable to find account with account number: ${bankAccountNumber}`);
        }

        // Find the transfer payee for the account we are transferring to
        const transferPayee = this._actual.payees.find(p => p.transfer_acct === actualAccountId);
        if (!transferPayee) {
          throw new Error(`Unable to find transfer payee for account: ${actualAccountId}, this should have been created when the account was created`);
        }

        return {
          ...transaction,
          payee: transferPayee.id,
          imported_id: referenceNumber,
        };
      } else if (row['Long description'].startsWith('Net tfr received from')) {
        // Ignore from transfers
        return undefined;
      }
    }

    // Otherwise there was some other transaction for some reason, mark as uncleared so it can be reviewed
    return {
      ...transaction,
      cleared: false,
    };
  }

  /**
   * Parse the 'ALL WDLS' transaction type, these are generally transactions to external accounts
   * @param row The CSV row to parse
   * @param transaction The base transaction object to add to
   * @returns The transaction object with the parsed values added, or undefined if the transaction should be ignored
   * @throws Error if the transaction information cannot be parsed or is unhandled
   */
  private parseTransactionTypeAllWdls(row: CSVDataRow, transaction: ITransaction): ITransaction | undefined {
    if (row['Long description'].startsWith('Osko Payment To')) {
      // Extract out the payee name and reference number, ignoring the account number, email, or phone number
      // Osko Payment To PERSON ONE person.one@example.com Ref#123456789
      // Osko Payment To Legitimate Business Account 123456 BANK - LOCATION Ref#123456789
      // Osko Payment To Z PERSON +61-400000000 Ref#123456789
      const regex = /Osko Payment To ([\w\s]+) (?:[\w@.]+|Account [\w\s-]+|[\+\d-]+) Ref#(\d+)/;
      const matches = regex.exec(row['Long description']);
      if (!matches) {
        throw new Error(`Unable to extract payee name and reference number from Osko payment: ${row['Long description']}`);
      }

      const payeeName = matches[1];
      const referenceNumber = matches[2];

      return {
        ...transaction,
        payee_name: payeeName,
        imported_id: referenceNumber,
      };
    } else if (row['Long description'].startsWith("Direct Debit")) {
      // Extract out the payee name and reference number
      // Direct Debit - COMPANY NAME - 123456789
      const regex = /Direct Debit ([\w\s]+) - .*/;
      const matches = regex.exec(row['Long description']);
      if (!matches) {
        throw new Error(`Unable to extract payee name from direct debit: ${row['Long description']}`);
      }

      const payeeName = matches[1];

      return {
        ...transaction,
        payee_name: payeeName,
      };
    }

    throw new Error(`Unhandled all wdls transaction type: ${row['Description']} | ${row['Long description']}`);
  }

  /**
   * Parse the 'ALL DEPOSITS' transaction type, these are generally transactions from external accounts
   * @param row The CSV row to parse
   * @param transaction The base transaction object to add to
   * @returns The transaction object with the parsed values added, or undefined if the transaction should be ignored
   * @throws Error if the transaction information cannot be parsed or is unhandled
   */
  private parseTransactionTypeAllDeposits(row: CSVDataRow, transaction: ITransaction): ITransaction | undefined {
    if (row['Long description'].startsWith('Osko Payment From')) {
      // Extract out the payee name and reference number, ignoring the account number, email, or phone number
      // Osko Payment From PERSON ONE
      const regex = /Osko Payment From ([\w\s]+)/;
      const matches = regex.exec(row['Long description']);
      if (!matches) {
        throw new Error(`Unable to extract payee name from Osko payment: ${row['Long description']}`);
      }

      const payeeName = matches[1];

      return {
        ...transaction,
        payee_name: payeeName,
      };
    } else if (row['Long description'].startsWith("Direct Credit")) {
      // Extract out the payee name and reference number
      // Direct Credit - COMPANY NAME - 123456789
      const regex = /Direct Credit (.+) - .*/;
      const matches = regex.exec(row['Long description']);
      if (!matches) {
        throw new Error(`Unable to extract payee name from direct credit: ${row['Long description']}`);
      }

      const payeeName = matches[1];

      return {
        ...transaction,
        payee_name: payeeName,
      };
    } else if (row['Long description'].startsWith("SWIFT")) {
      // Not much information to go off here. So just use the description as the payee name
      // SWIFT|SWIFT PAYMENT|SWIFTPMT
      return {
        ...transaction,
        payee_name: row['Description'],
      };
    }

    throw new Error(`Unhandled all deposits transaction type: ${row['Description']} | ${row['Long description']}`);
  }

  /**
   * Parse the 'BPAY' transaction type
   * @param row The CSV row to parse
   * @param transaction The base transaction object to add to
   * @returns The transaction object with the parsed values added, or undefined if the transaction should be ignored
   * @throws Error if the transaction information cannot be parsed or is unhandled
   */
  private parseTransactionTypeBPay(row: CSVDataRow, transaction: ITransaction): ITransaction | undefined {
    // Extract out the payee name and reference number, use biller code and receipt number as the imported id
    // Internet BPay to Company Name - Biller Code 32456 - Receipt No 123456789
    const regex = /Internet BPay to ([\w\s]+) - Biller Code (\d+) - Receipt No (\d+)/;
    const matches = regex.exec(row['Long description']);
    if (!matches) {
      throw new Error(`Unable to extract payee name and reference number from BPay payment: ${row['Long description']}`);
    }

    const payeeName = matches[1];
    const billerCode = matches[2];
    const receiptNumber = matches[3];

    return {
      ...transaction,
      payee_name: payeeName,
      imported_id: `${billerCode}-${receiptNumber}`,
    };
  }

  /**
   * Parse the 'VISA' transaction type
   * @param row The CSV row to parse
   * @param transaction The base transaction object to add to
   * @returns The transaction object with the parsed values added, or undefined if the transaction should be ignored
   * @throws Error if the transaction information cannot be parsed or is unhandled
   */
  private async parseTransactionTypeVisaAsync(row: CSVDataRow, transaction: ITransaction): Promise<ITransaction | undefined> {
    const categoryList = row['Category list'];

    let category_name = BankAustralia.CategoryOverrides[categoryList] ?? categoryList.split(',').pop()?.trim();

    let payee_name;
    const merchantName = row['Merchant name'];
    // If the merchant name is present, use it as the payee name
    // Except if it's PayPal or Square, as they don't provide useful information of underlying the merchant
    // Sometimes PayPal or Square registers with VISA the underlying merchant name, but not always
    // e.g. "VISA-PAYPAL *HELLOFRESH 11111111 AU#0000000(Ref.123456789)" the merchant name is "HelloFresh" with category "Groceries"
    // but "VISA-PAYPAL *STORE NAME 9999999 AU#123456(Ref.123456789)" the merchant name is "PayPal" with category "Payment Gateway, Services"
    if (
      merchantName &&
      merchantName !== 'PayPal' &&
      merchantName !== 'Square'
    ) {
      const payeeNameParts = row['Merchant name'].split('(');
      payee_name = payeeNameParts[0].trim();
    } else {
      // No merchant name or it's PayPal or Square with the payment processor as the merchant, so extract from long description
      // e.g.
      // VISA-CLOUDFLARE HTTPSWWW.CLOUUSFRGN AMT-11.1111111#123455(Ref.0123456789) -> Cloudflare
      // VISA-PAYPAL *STORE NAME 9999999 AU#123456(Ref.0123456781) -> Store Name
      // VISA-SQ *LOCAL BREWERY Sydney AU#0123456(Ref.0123456789) Android Pay -> Local Brewery
      // VISA Refund-Store Name NL#234567(Ref.0123456789) -> Store Name
      // Note that category won't be able to be extracted here, so this will be a manual process within the app
      // Suggested to setup a rule to automatically categorise these transactions
      let regex = /VISA(?: Refund)?-(.*?)( HTTP| WWW|#)/;

      if (merchantName === 'PayPal' || merchantName === 'Square') {
        // Transactions have the merchant name in the description in uppercase letters, numbers, periods, spaces.
        // Select the name between the * and a space followed by a number or a capital then lowercase letter (e.g. 1 or Aa)
        // This would be some merchant id or a location or store name we don't want as the payee name
        regex = /\*([\w]*[A-Z\. ]*)(?=\d|[A-Z][a-z])/;
      }

      const match = row['Long description'].match(regex);
      if (!match) {
        throw new Error(`Unable to extract payee name from VISA payment: ${row['Long description']}`);
      }

      payee_name = toTitleCase(match[1]).trim();
    }

    let category = this._actual.categories.find((c) => c.name === category_name);

    if (!category && category_name) {
      console.info(`Category not found: ${category_name}, creating...`);
      category = await this._actual.createCategoryAsync(category_name);
    }

    const referenceNumberRegex = /Ref\.(\d+)/;
    const referenceNumberMatches = row['Long description'].match(referenceNumberRegex);
    let imported_id: string | undefined;
    if (!referenceNumberMatches) {
      console.warn(`Unable to extract reference number from VISA payment: ${row['Long description']}`);
    } else {
      imported_id = referenceNumberMatches[1];
    }

    return {
      ...transaction,
      payee_name,
      category: category ? category.id : undefined,
      imported_id
    };
  }
}
