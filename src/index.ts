// This script will import transactions from a CSV file exported from the Bank Australia app
// It will create categories as needed, and set the category based on the category list in the CSV
// It will also set the payee name based on the merchant name, or the long description if no merchant name is available
import { Command } from '@commander-js/extra-typings';

import { BankAustralia } from './bank_australia';
import { Actual } from "./actual";
import { UUID } from 'crypto';


const program = new Command()
  .requiredOption('-u, --url <url>', 'Actual URL')
  .requiredOption('-p, --password <password>', 'Actual password')
  .requiredOption('-s, --sync-id <syncId>', 'Actual Sync ID (found in settings > Advanced Settings)')
  .requiredOption('-m, --account-mapping <account-mappings...>', 'Account mapping in the format: bank-account-id=actual-account-id')
  .requiredOption('-f, --file <files...>', 'File to import');

program.parse();

const options = program.opts();
console.log(options, program.args);

const mapping = new Map<string, UUID>();
for (const mappingStr of options.accountMapping) {
  const [bankAccountId, actualAccountId] = mappingStr.split('=');

  if (!BankAustralia.CheckAccountIdFormat(bankAccountId) || !Actual.CheckAccountIdFormat(actualAccountId)) {
    console.error(`Invalid account mapping or invalid account format: ${mappingStr}`);
    process.exit(1);
  }

  mapping.set(bankAccountId, actualAccountId as UUID);
}

async function main(): Promise<void> {
  const actual = new Actual(options.url, options.password, options.syncId);
  const bank = new BankAustralia(mapping, actual);

  for (const file of options.file) {
    await bank.importTransactionsAsync(file);
  }

  await actual.shutdownActualAsync();
}

(async () => {
  await main();
})();
