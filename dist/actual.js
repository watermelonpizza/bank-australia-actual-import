"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Actual = void 0;
const api_1 = require("@actual-app/api");
const fs_1 = require("fs");
class Actual {
    _serverURL;
    _password;
    _syncId;
    _isInitialised = false;
    get isInitialised() {
        return this._isInitialised;
    }
    _accounts = [];
    get accounts() {
        return this._accounts;
    }
    _payees = [];
    get payees() {
        return this._payees;
    }
    _categoryGroups = [];
    /**
     * Get the category groups
     * Note: categoryGroups not implemented yet and will only return what is gathered from known categories
     *
     * @returns {ICategoryGroup[]}
     */
    get categoryGroups() {
        return this._categoryGroups;
    }
    _defaultCategoryGroupId;
    get defaultCategoryGroupId() {
        return this._defaultCategoryGroupId;
    }
    _incomeCategoryGroupId;
    get incomeCategoryGroupId() {
        return this._incomeCategoryGroupId;
    }
    _categories = [];
    get categories() {
        return this._categories;
    }
    /**
     * Check if the account ID is in the correct format
     * @param accountId The account ID to check
     * @returns {boolean} True if the account ID is in the correct format
     * @static
     * @memberof Actual
     * @example Actual.CheckAccountIdFormat('00000000-0000-0000-0000-000000000000'); // true
     * @example Actual.CheckAccountIdFormat('hello'); // false
     */
    static CheckAccountIdFormat(accountId) {
        if (!accountId)
            return false;
        return /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.test(accountId);
    }
    constructor(serverURL, password, syncId) {
        this._serverURL = serverURL;
        this._password = password;
        this._syncId = syncId;
    }
    async initialiseActualAsync() {
        (0, fs_1.mkdirSync)('./data/budgets', { recursive: true });
        await (0, api_1.init)({
            dataDir: './data/budgets',
            serverURL: this._serverURL,
            password: this._password
        });
        await (0, api_1.downloadBudget)(this._syncId);
        this._accounts = await (0, api_1.getAccounts)();
        this._payees = await (0, api_1.getPayees)();
        this._categories = await (0, api_1.getCategories)();
        if (!this._categories) {
            throw new Error('No categories found');
        }
        this._categoryGroups = this._categories?.map((c) => ({ id: c.group_id }));
        // TODO: Get the default category group ID when getCategoryGroups() is implemented
        this._defaultCategoryGroupId = this._categories.filter(c => !c.is_income)[0].group_id;
        this._incomeCategoryGroupId = this._categories.filter(c => !!c.is_income)[0].group_id;
        this._isInitialised = true;
    }
    async createCategoryAsync(category) {
        if (!this._isInitialised) {
            throw new Error('Actual not initialised, call initialiseActual() first');
        }
        if (typeof category === 'string') {
            if (!this.defaultCategoryGroupId) {
                throw new Error('No default category group ID found, cannot create category');
            }
            if (!this.incomeCategoryGroupId) {
                throw new Error('No income category group ID found, cannot create category');
            }
            category = {
                name: category,
                group_id: (category === 'Interest' ? this.incomeCategoryGroupId : this.defaultCategoryGroupId)
            };
        }
        const newCategoryId = await (0, api_1.createCategory)(category);
        category.id = newCategoryId;
        this._categories.push(category);
        return category;
    }
    async importTransactionsAsync(account, transactions) {
        if (!this._isInitialised) {
            throw new Error('Actual not initialised, call initialiseActual() first');
        }
        let accountObj = this._accounts.find((a) => a.id === account || a.name === account);
        if (!accountObj) {
            throw new Error(`Account ${account} not found`);
        }
        console.log(`Importing ${transactions.length} transactions into ${accountObj.name}...`);
        const { errors, added, updated } = await (0, api_1.importTransactions)(accountObj.id, transactions);
        console.log(`Added ${added?.length} transactions, updated ${updated?.length}, errors: ${errors?.length}`);
        return { errors, added, updated };
    }
    async syncActualAsync() {
        if (!this._isInitialised) {
            throw new Error('Actual not initialised, call initialiseActual() first');
        }
        await (0, api_1.downloadBudget)(this._syncId);
    }
    async shutdownActualAsync() {
        if (!this._isInitialised) {
            throw new Error('Actual not initialised, call initialiseActual() first');
        }
        await (0, api_1.shutdown)();
        this._isInitialised = false;
    }
}
exports.Actual = Actual;
//# sourceMappingURL=actual.js.map