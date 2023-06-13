"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// This script will import transactions from a CSV file exported from the Bank Australia app
// It will create categories as needed, and set the category based on the category list in the CSV
// It will also set the payee name based on the merchant name, or the long description if no merchant name is available
const extra_typings_1 = require("@commander-js/extra-typings");
const bank_australia_1 = require("./bank_australia");
const actual_1 = require("./actual");
const program = new extra_typings_1.Command()
    .requiredOption('-u, --url <url>', 'Actual URL')
    .requiredOption('-p, --password <password>', 'Actual password')
    .requiredOption('-s, --sync-id <syncId>', 'Actual Sync ID (found in settings > Advanced Settings)')
    .requiredOption('-m, --account-mapping <account-mappings...>', 'Account mapping in the format: bank-account-id=actual-account-id')
    .requiredOption('-f, --file <files...>', 'File to import');
program.parse();
const options = program.opts();
console.log(options, program.args);
const mapping = new Map();
for (const mappingStr of options.accountMapping) {
    const [bankAccountId, actualAccountId] = mappingStr.split('=');
    if (!bank_australia_1.BankAustralia.CheckAccountIdFormat(bankAccountId) || !actual_1.Actual.CheckAccountIdFormat(actualAccountId)) {
        console.error(`Invalid account mapping or invalid account format: ${mappingStr}`);
        process.exit(1);
    }
    mapping.set(bankAccountId, actualAccountId);
}
async function main() {
    const actual = new actual_1.Actual(options.url, options.password, options.syncId);
    const bank = new bank_australia_1.BankAustralia(mapping, actual);
    for (const file of options.file) {
        await bank.importTransactionsAsync(file);
    }
    await actual.shutdownActualAsync();
}
(async () => {
    await main();
})();
//# sourceMappingURL=index.js.map