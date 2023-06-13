import {
  init,
  importTransactions,
  shutdown,
  getAccounts,
  downloadBudget,
  getCategories,
  createCategory,
  getPayees
} from '@actual-app/api';
import { UUID } from 'crypto';
import { mkdirSync } from 'fs';


export interface ICategory {
  id?: UUID;
  name: string;
  group_id: UUID;
  is_income?: boolean;
}

export interface ICategoryGroup {
  id?: UUID;
  name: string;
  is_income?: boolean;
  categories?: ICategory[];
}

export interface IAccount {
  id?: UUID;
  name: string;
  type:
  | 'checking'
  | 'savings'
  | 'credit'
  | 'investment'
  | 'mortgage'
  | 'debt'
  | 'other';
  offbudget?: boolean;
  closed?: boolean;
}

export interface ITransaction {
  id?: UUID;
  account: UUID;
  date: Date;
  amount?: number;
  payee?: UUID;
  payee_name?: string;
  imported_payee?: string;
  category?: UUID;
  notes?: string;
  imported_id?: string;
  transfer_id?: string;
  cleared?: boolean;
  subtransactions?: ITransaction[];
}

export interface IPayee {
  id?: UUID;
  name: string;
  category?: UUID;
  transfer_acct?: UUID;
}


export class Actual {
  private _serverURL: string;
  private _password: string;
  private _syncId: string;

  private _isInitialised = false;

  public get isInitialised(): boolean {
    return this._isInitialised;
  }

  private _accounts: IAccount[] = [];
  public get accounts(): IAccount[] {
    return this._accounts;
  }

  private _payees: IPayee[] = [];
  public get payees(): IPayee[] {
    return this._payees;
  }

  private _categoryGroups: ICategoryGroup[] = [];
  /**
   * Get the category groups
   * Note: categoryGroups not implemented yet and will only return what is gathered from known categories
   *
   * @returns {ICategoryGroup[]}
   */
  public get categoryGroups(): ICategoryGroup[] {
    return this._categoryGroups;
  }

  private _defaultCategoryGroupId: UUID | undefined;
  public get defaultCategoryGroupId(): UUID | undefined {
    return this._defaultCategoryGroupId;
  }

  private _incomeCategoryGroupId: UUID | undefined;
  public get incomeCategoryGroupId(): UUID | undefined {
    return this._incomeCategoryGroupId;
  }

  private _categories: ICategory[] = [];
  public get categories(): ICategory[] {
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
  public static CheckAccountIdFormat(accountId: string): boolean {
    if (!accountId) return false;
    return /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.test(accountId);
  }

  constructor(serverURL: string, password: string, syncId: string) {
    this._serverURL = serverURL;
    this._password = password;
    this._syncId = syncId;
  }

  async initialiseActualAsync(): Promise<void> {
    mkdirSync('./data/budgets', { recursive: true });

    await init({
      dataDir: './data/budgets',
      serverURL: this._serverURL,
      password: this._password
    });

    await downloadBudget(this._syncId);

    this._accounts = await getAccounts();
    this._payees = await getPayees();
    this._categories = await getCategories();

    if (!this._categories) {
      throw new Error('No categories found');
    }

    this._categoryGroups = this._categories?.map(
      (c) => ({ id: c.group_id } as ICategoryGroup)
    );

    // TODO: Get the default category group ID when getCategoryGroups() is implemented
    this._defaultCategoryGroupId = this._categories.filter(c => !c.is_income)[0].group_id;
    this._incomeCategoryGroupId = this._categories.filter(c => !!c.is_income)[0].group_id;

    this._isInitialised = true;
  }

  async createCategoryAsync(category: ICategory | string): Promise<ICategory> {
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

    const newCategoryId = await createCategory(category);
    category.id = newCategoryId;

    this._categories.push(category);

    return category;
  }

  async importTransactionsAsync(account: string, transactions: ITransaction[]): Promise<any> {
    if (!this._isInitialised) {
      throw new Error('Actual not initialised, call initialiseActual() first');
    }

    let accountObj = this._accounts.find((a) => a.id === account || a.name === account);
    if (!accountObj) {
      throw new Error(`Account ${account} not found`);
    }

    console.log(`Importing ${transactions.length} transactions into ${accountObj.name}...`);

    const { errors, added, updated } = await importTransactions(accountObj.id, transactions);

    console.log(
      `Added ${added?.length} transactions, updated ${updated?.length}, errors: ${errors?.length}`
    );

    return { errors, added, updated };
  }

  async syncActualAsync(): Promise<any> {
    if (!this._isInitialised) {
      throw new Error('Actual not initialised, call initialiseActual() first');
    }

    await downloadBudget(this._syncId);
  }

  async shutdownActualAsync(): Promise<void> {
    if (!this._isInitialised) {
      throw new Error('Actual not initialised, call initialiseActual() first');
    }

    await shutdown();
    this._isInitialised = false;
  }
}
