import crypto from 'crypto';

import { StarkwareLib } from '@dydxprotocol/starkex-eth';
import {
  ApiMethod,
  KeyPair,
  OrderWithClientId,
  SignableOrder,
  SignableWithdrawal,
  asEcKeyPair,
  asSimpleKeyPair,
  SignableConditionalTransfer,
  SignableTransfer,
  nonceFromClientId,
  TransferParams as StarklibTransferParams,
} from '@dydxprotocol/starkex-lib';
import _ from 'lodash';

import { generateQueryPath, generateRandomClientId } from '../helpers/request-helpers';
import {
  RequestMethod,
  axiosRequest,
} from '../lib/axios';
import { getAccountId } from '../lib/db';
import {
  AccountAction,
  AccountLeaderboardPnlResponseObject,
  AccountResponseObject,
  ApiFastWithdrawal,
  ApiFastWithdrawalParams,
  ApiKeyCredentials,
  ApiOrder,
  ApiTransfer,
  ApiWithdrawal,
  Data,
  FillResponseObject,
  FundingResponseObject,
  GenericParams,
  HistoricalPnlResponseObject,
  ISO8601,
  LeaderboardPnlPeriod,
  Market,
  OrderResponseObject,
  OrderSide,
  OrderStatus,
  OrderType,
  PartialBy,
  PositionResponseObject,
  PositionStatus,
  Provider,
  TransferParams,
  TransferResponseObject,
  UserResponseObject,
} from '../types';
import Clock from './clock';

// TODO: Figure out if we can get rid of this.
const METHOD_ENUM_MAP: Record<RequestMethod, ApiMethod> = {
  [RequestMethod.DELETE]: ApiMethod.DELETE,
  [RequestMethod.GET]: ApiMethod.GET,
  [RequestMethod.POST]: ApiMethod.POST,
  [RequestMethod.PUT]: ApiMethod.PUT,
};

const collateralTokenDecimals = 6;

export default class Private {
  readonly host: string;
  readonly apiKeyCredentials: ApiKeyCredentials;
  readonly networkId: number;
  readonly starkLib: StarkwareLib;
  readonly starkKeyPair?: KeyPair;
  readonly clock: Clock;

  constructor({
    host,
    apiKeyCredentials,
    starkPrivateKey,
    networkId,
    clock,
  }: {
    host: string,
    apiKeyCredentials: ApiKeyCredentials,
    networkId: number,
    starkPrivateKey?: string | KeyPair,
    clock: Clock,
  }) {
    this.host = host;
    this.apiKeyCredentials = apiKeyCredentials;
    this.networkId = networkId;
    this.starkLib = new StarkwareLib({} as Provider, networkId);
    if (starkPrivateKey) {
      this.starkKeyPair = asSimpleKeyPair(asEcKeyPair(starkPrivateKey));
    }
    this.clock = clock;
  }

  // ============ Request Helpers ============

  protected async request(
    method: RequestMethod,
    endpoint: string,
    data?: {},
  ): Promise<Data> {
    const requestPath = `/v3/${endpoint}`;
    const isoTimestamp: ISO8601 = this.clock.getAdjustedIsoString();
    const headers = {
      'DYDX-SIGNATURE': this.sign({
        requestPath,
        method,
        isoTimestamp,
        data,
      }),
      'DYDX-API-KEY': this.apiKeyCredentials.key,
      'DYDX-TIMESTAMP': isoTimestamp,
      'DYDX-PASSPHRASE': this.apiKeyCredentials.passphrase,
    };
    return axiosRequest({
      url: `${this.host}${requestPath}`,
      method,
      data,
      headers,
    });
  }

  protected async _get(
    endpoint: string,
    params: {},
  ): Promise<Data> {
    return this.request(RequestMethod.GET, generateQueryPath(endpoint, params));
  }

  protected async post(
    endpoint: string,
    data: {},
  ): Promise<Data> {
    return this.request(RequestMethod.POST, endpoint, data);
  }

  protected async put(
    endpoint: string,
    data: {},
  ): Promise<Data> {
    return this.request(RequestMethod.PUT, endpoint, data);
  }

  protected async delete(
    endpoint: string,
    params: {},
  ): Promise<Data> {
    return this.request(RequestMethod.DELETE, generateQueryPath(endpoint, params));
  }

  // ============ Requests ============

  async get(endpoint: string, params: {}): Promise<Data> {
    return this._get(
      endpoint,
      params,
    );
  }

  /**
   * @description get a signature for the ethereumAddress if registered
   */
  async getRegistration(genericParams: GenericParams = {}): Promise<{ signature: string }> {
    return this._get(
      'registration',
      {
        ...genericParams,
      },
    );
  }

  /**
   * @description get the user associated with the ethereumAddress
   */
  async getUser(genericParams: GenericParams = {}): Promise<{ user: UserResponseObject }> {
    return this._get(
      'users',
      {
        ...genericParams,
      },
    );
  }

  /**
   * @description update information for the user
   *
   * @param {
   * @email associated with the user
   * @username for the user
   * @userData specifiying information about the user
   * }
   */
  async updateUser({
    email,
    username,
    userData,
  }: {
    email: string,
    username: string,
    userData: {},
  }): Promise<{ user: UserResponseObject }> {
    return this.put(
      'users',
      {
        email,
        username,
        userData: JSON.stringify(userData),
      },
    );
  }

  /**
   * @description create an account for an ethereumAddress
   *
   * @param starkKey for the account that will be used as the public key in starkwareEx-Lib requests
   * going forward for this account.
   * @param starkKeyYCoordinate for the account that will be used as the Y coordinate for the public
   * key in starkwareEx-Lib requests going forward for this account.
   */
  async createAccount(
    starkKey: string,
    starkKeyYCoordinate: string,
  ): Promise<{ account: AccountResponseObject }> {
    return this.post(
      'accounts',
      {
        starkKey,
        starkKeyYCoordinate,
      },
    );
  }

  /**
   * @description get account associated with an ethereumAddress and accountNumber 0
   *
   * @param ethereumAddress the account is associated with
   */
  async getAccount(
    ethereumAddress: string,
    genericParams: GenericParams = {},
  ): Promise<{ account: AccountResponseObject }> {
    return this._get(
      `accounts/${getAccountId({ address: ethereumAddress })}`,
      { ...genericParams },
    );
  }

  /**
   * @description get all accounts associated with an ethereumAddress
   */
  async getAccounts(
    genericParams: GenericParams = {},
  ): Promise<{ accounts: AccountResponseObject[] }> {
    return this._get(
      'accounts',
      { ...genericParams },
    );
  }

  /**
   * @description get leaderboard pnl for period and accountNumber 0
   *
   * @param period the period of pnls to retrieve
   */
  async getAccountLeaderboardPnl(
    period: LeaderboardPnlPeriod,
    genericParams: GenericParams = {},
  ): Promise<{ leaderboardPnl: AccountLeaderboardPnlResponseObject }> {
    return this._get(
      `accounts/leaderboard-pnl/${period}`,
      genericParams,
    );
  }

  /**
   * @description get all positions for an account, meeting query parameters
   *
   * @param {
   * @market the positions are for
   * @status of the positions
   * @limit to the number of positions returned
   * @createdBeforeOrAt latest the positions could have been created
   * }
   */
  async getPositions(
    params: {
      market?: Market,
      status?: PositionStatus,
      limit?: number,
      createdBeforeOrAt?: ISO8601,
    },
    genericParams: GenericParams = {},
  ): Promise<{ positions: PositionResponseObject[] }> {
    return this._get(
      'positions',
      {
        ...params,
        ...genericParams,
      },
    );
  }

  /**
   * @description get orders for a user by a set of query parameters
   *
   * @param {
   * @market the orders are for
   * @status the orders have
   * @side of the book the orders are on
   * @type of order
   * @limit to the number of orders returned
   * @createdBeforeOrAt sets the time of the last fill that will be received   * }
   */
  async getOrders(
    params: {
      market?: Market,
      status?: OrderStatus,
      side?: OrderSide,
      type?: OrderType,
      limit?: number,
      createdBeforeOrAt?: ISO8601,
    } = {},
    genericParams: GenericParams = {},
  ): Promise<{ orders: OrderResponseObject[] }> {
    return this._get(
      'orders',
      {
        ...params,
        ...genericParams,
      },
    );
  }

  /**
   * @description get an order by a unique id
   *
   * @param orderId of the order
   */
  async getOrderById(
    orderId: string,
    genericParams: GenericParams = {},
  ): Promise<{ order: OrderResponseObject }> {
    return this._get(
      `orders/${orderId}`,
      { ...genericParams },
    );
  }

  /**
   * @description get an order by a clientId
   *
   * @param clientId of the order
   */
  async getOrderByClientId(
    clientId: string,
    genericParams: GenericParams = {},
  ): Promise<{ order: OrderResponseObject }> {
    return this._get(
      `orders/client/${clientId}`,
      { ...genericParams },
    );
  }

  /**
   *@description place a new order
   *
   * @param {
   * @market of the order
   * @side of the order
   * @type of the order
   * @timeInForce of the order
   * @postOnly of the order
   * @size of the order
   * @price of the order
   * @limitFee of the order
   * @expiration of the order
   * @cancelId if the order is replacing an existing one
   * @triggerPrice of the order if the order is a triggerable order
   * @trailingPercent of the order if the order is a trailing stop order
   * }
   * @param positionId associated with the order
   */
  async createOrder(
    params: PartialBy<ApiOrder, 'clientId' | 'signature'>,
    positionId: string,
  ): Promise<{ order: OrderResponseObject }> {
    const clientId = params.clientId || generateRandomClientId();

    let signature: string | undefined = params.signature;
    if (!signature) {
      if (!this.starkKeyPair) {
        throw new Error('Order is not signed and client was not initialized with starkPrivateKey');
      }
      const orderToSign: OrderWithClientId = {
        humanSize: params.size,
        humanPrice: params.price,
        limitFee: params.limitFee,
        market: params.market,
        side: params.side,
        expirationIsoTimestamp: params.expiration,
        clientId,
        positionId,
      };
      const starkOrder = SignableOrder.fromOrder(orderToSign, this.networkId);
      signature = await starkOrder.sign(this.starkKeyPair);
    }

    const order: ApiOrder = {
      ...params,
      clientId,
      signature,
    };

    return this.post(
      'orders',
      order,
    );
  }

  /**
   * @description cancel a specific order for a user by the order's unique id
   *
   * @param orderId of the order being canceled
   */
  async cancelOrder(orderId: string): Promise<{ cancelOrder: OrderResponseObject }> {
    return this.delete(
      `orders/${orderId}`,
      {},
    );
  }

  /**
   * @description cancel all orders for a user for a specific market
   *
   * @param market of the orders being canceled
   */
  async cancelAllOrders(market?: Market): Promise<{ cancelOrders: OrderResponseObject[] }> {
    const params = market ? { market } : {};
    return this.delete(
      'orders',
      params,
    );
  }

  /**
   *@description get fills for a user by a set of query parameters
   *
   * @param {
   * @market the fills are for
   * @orderId associated with the fills
   * @limit to the number of fills returned
   * @createdBeforeOrAt sets the time of the last fill that will be received
   * }
   */
  async getFills(
    params: {
      market?: Market,
      orderId?: string,
      limit?: number,
      createdBeforeOrAt?: ISO8601,
    },
    genericParams: GenericParams = {},
  ): Promise<{ fills: FillResponseObject[] }> {
    return this._get(
      'fills',
      {
        ...params,
        ...genericParams,
      },
    );
  }

  /**
   * @description get transfers for a user by a set of query parameters
   *
   * @param {
   * @type of transfer
   * @limit to the number of transfers returned
   * @createdBeforeOrAt sets the time of the last transfer that will be received
   * }
   */
  async getTransfers(
    params: {
      type?: AccountAction,
      limit?: number,
      createdBeforeOrAt?: ISO8601,
    } = {},
    genericParams: GenericParams = {},
  ): Promise<{ transfers: TransferResponseObject[] }> {
    return this._get(
      'transfers',
      {
        ...params,
        ...genericParams,
      },
    );
  }

  /**
   * @description post a new withdrawal
   *
   * @param {
   * @amount specifies the size of the withdrawal
   * @asset specifies the asset being withdrawn
   * @clientId specifies the clientId for the address
   * }
   * @param positionId specifies the associated position for the transfer
   */
  async createWithdrawal(
    params: PartialBy<ApiWithdrawal, 'clientId' | 'signature'>,
    positionId: string,
  ): Promise<{ withdrawal: TransferResponseObject }> {
    const clientId = params.clientId || generateRandomClientId();

    let signature: string | undefined = params.signature;
    if (!signature) {
      if (!this.starkKeyPair) {
        throw new Error(
          'Withdrawal is not signed and client was not initialized with starkPrivateKey',
        );
      }
      const withdrawalToSign = {
        humanAmount: params.amount,
        expirationIsoTimestamp: params.expiration,
        clientId,
        positionId,
      };
      const starkWithdrawal = SignableWithdrawal.fromWithdrawal(withdrawalToSign, this.networkId);
      signature = await starkWithdrawal.sign(this.starkKeyPair);
    }

    const withdrawal: ApiWithdrawal = {
      ...params,
      clientId,
      signature,
    };

    return this.post(
      'withdrawals',
      withdrawal,
    );
  }

  /**
   * @description post a new fast-withdrawal
   *
   * @param {
    * @creditAmount specifies the size of the withdrawal
    * @debitAmount specifies the amount to be debited
    * @creditAsset specifies the asset being withdrawn
    * @toAddress is the address being withdrawn to
    * @lpPositionId is the LP positionId for the fast withdrawal
    * @clientId specifies the clientId for the address
    * @signature starkware specific signature for fast-withdrawal
    * }
    */
  async createFastWithdrawal(
    {
      lpStarkKey,
      ...params
    }: PartialBy<ApiFastWithdrawalParams, 'clientId' | 'signature'>,
    positionId: string,
  ): Promise<{ withdrawal: TransferResponseObject }> {
    const clientId = params.clientId || generateRandomClientId();
    let signature: string | undefined = params.signature;
    if (!signature) {
      if (!this.starkKeyPair) {
        throw new Error('Fast withdrawal is not signed and client was not initialized with starkPrivateKey');
      }
      const fact = this.starkLib.factRegistry.getTransferErc20Fact({
        recipient: params.toAddress,
        tokenAddress: this.starkLib.collateralToken.getAddress(),
        tokenDecimals: collateralTokenDecimals,
        humanAmount: params.creditAmount,
        salt: nonceFromClientId(clientId),
      });
      const transferToSign = {
        senderPositionId: positionId,
        receiverPositionId: params.lpPositionId,
        receiverPublicKey: lpStarkKey,
        factRegistryAddress: this.starkLib.factRegistry.getAddress(),
        fact,
        humanAmount: params.debitAmount,
        clientId,
        expirationIsoTimestamp: params.expiration,
      };
      const starkConditionalTransfer = SignableConditionalTransfer.fromTransfer(
        transferToSign,
        this.networkId,
      );
      signature = await starkConditionalTransfer.sign(this.starkKeyPair);
    }
    const fastWithdrawal: ApiFastWithdrawal = {
      ...params,
      clientId,
      signature,
    };

    return this.post(
      'fast-withdrawals',
      fastWithdrawal,
    );
  }

  /**
     * @description post a new transfer
     *
     * @param {
      * @amount specifies the size of the transfer
      * @receiverAccountId specifies the receiver account id
      * @receiverPublicKey specifies the receiver public key
      * @receiverPositionId specifies the receiver position id
      * @clientId specifies the clientId for the address
      * @signature starkware specific signature for the transfer
      * }
      * @param positionId specifies the associated position for the transfer
      */
  async createTransfer(
    params: PartialBy<TransferParams, 'clientId' | 'signature'>,
    positionId: string,
  ): Promise<{ transfer: TransferResponseObject }> {
    const clientId = params.clientId || generateRandomClientId();

    let signature: string | undefined = params.signature;
    if (!signature) {
      if (!this.starkKeyPair) {
        throw new Error(
          'Transfer is not signed and client was not initialized with starkPrivateKey',
        );
      }
      const transferToSign: StarklibTransferParams = {
        humanAmount: params.amount,
        expirationIsoTimestamp: params.expiration,
        receiverPositionId: params.receiverPositionId,
        senderPositionId: positionId,
        receiverPublicKey: params.receiverPublicKey,
        clientId,
      };
      const starkTransfer = SignableTransfer.fromTransfer(transferToSign, this.networkId);
      signature = await starkTransfer.sign(this.starkKeyPair);
    }

    const transfer: ApiTransfer = {
      amount: params.amount,
      receiverAccountId: params.receiverAccountId,
      clientId,
      signature,
      expiration: params.expiration,
    };

    return this.post(
      'transfers',
      transfer,
    );
  }

  /**
   * @description get a user's funding payments by a set of query parameters
   *
   * @param {
   * @market the funding payments are for
   * @limit to the number of funding payments returned
   * @effectiveBeforeOrAt sets the latest funding payment received
   * }
   */
  async getFundingPayments(
    params: {
      market?: Market,
      limit?: number,
      effectiveBeforeOrAt?: ISO8601,
    },
    genericParams: GenericParams = {},
  ): Promise<{ fundingPayments: FundingResponseObject }> {
    return this._get(
      'funding',
      {
        ...params,
        ...genericParams,
      },
    );
  }

  /**
   * @description get historical pnl ticks for an account between certain times
   *
   * @param {
   * @createdBeforeOrAt latest historical pnl tick being returned
   * @createdOnOrAfter earliest historical pnl tick being returned
   * }
   */
  getHistoricalPnl(
    params: {
      createdBeforeOrAt?: ISO8601,
      createdOnOrAfter?: ISO8601,
    },
    genericParams: GenericParams = {},
  ): Promise<{ historicalPnl: HistoricalPnlResponseObject[] }> {
    return this._get(
      'historical-pnl',
      {
        ...params,
        ...genericParams,
      },
    );
  }

  /**
   * @description get the key ids associated with an ethereumAddress
   *
   */
  async getApiKeys(
    genericParams: GenericParams = {},
  ): Promise<{ apiKeys: { key: string }[] }> {
    return this._get('api-keys', { ...genericParams });
  }

  /**
   * @description send verification email to email specified by User
   */
  async sendVerificationEmail(): Promise<{}> {
    return this.put(
      'emails/send-verification-email',
      {},
    );
  }

  // ============ Signing ============

  sign({
    requestPath,
    method,
    isoTimestamp,
    data,
  }: {
    requestPath: string,
    method: RequestMethod,
    isoTimestamp: ISO8601,
    data?: {},
  }): string {
    const messageString: string = (
      isoTimestamp +
      METHOD_ENUM_MAP[method] +
      requestPath +
      (_.isEmpty(data) ? '' : JSON.stringify(data))
    );

    return crypto.createHmac(
      'sha256',
      Buffer.from(this.apiKeyCredentials.secret, 'base64'),
    ).update(messageString).digest('base64');
  }
}
