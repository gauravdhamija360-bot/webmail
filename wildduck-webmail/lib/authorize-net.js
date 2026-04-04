'use strict';

const authorizenet = require('authorizenet');

const SDK = authorizenet.APIContracts;
const SDKController = authorizenet.APIControllers;
const SDKConstants = authorizenet.Constants;

const getEnvironment = () => {
    if (process.env.AUTHORIZE_ENV === 'production') {
        return SDKConstants.endpoint.production;
    }

    return SDKConstants.endpoint.sandbox;
};

const createMerchantAuthentication = () => {
    const merchantAuthenticationType = new SDK.MerchantAuthenticationType();
    merchantAuthenticationType.setName(process.env.AUTHORIZE_API_LOGIN_ID);
    merchantAuthenticationType.setTransactionKey(process.env.AUTHORIZE_TRANSACTION_KEY);
    return merchantAuthenticationType;
};

const execute = (Controller, request) =>
    new Promise((resolve, reject) => {
        const controller = new Controller(request.getJSON());
        controller.setEnvironment(getEnvironment());
        controller.execute(() => {
            const rawResponse = controller.getResponse();

            if (!rawResponse) {
                return reject(new Error('No response from Authorize.Net'));
            }

            return resolve(rawResponse);
        });
    });

const getPrimaryMessage = response => {
    const messages = response && response.getMessages && response.getMessages();
    const messageList = messages && messages.getMessage && messages.getMessage();

    if (Array.isArray(messageList) && messageList.length) {
        return messageList[0].getText();
    }

    return 'Unknown gateway error';
};

const createGatewayError = (response, fallback) => {
    const message = fallback || getPrimaryMessage(response);
    const error = new Error(message);
    error.gatewayResponse = response;
    return error;
};

const getTransactionErrorText = transactionResponse => {
    if (!transactionResponse) {
        return 'Transaction declined';
    }

    const errors = transactionResponse.getErrors && transactionResponse.getErrors();
    const errorList = errors && errors.getError && errors.getError();
    if (Array.isArray(errorList) && errorList.length) {
        const error = errorList[0];
        const code = error.getErrorCode && error.getErrorCode();
        const text = error.getErrorText && error.getErrorText();
        return [code, text].filter(Boolean).join(': ') || 'Transaction declined';
    }

    const messages = transactionResponse.getMessages && transactionResponse.getMessages();
    const messageList = messages && messages.getMessage && messages.getMessage();
    if (Array.isArray(messageList) && messageList.length) {
        const message = messageList[0];
        const code = message.getCode && message.getCode();
        const text = message.getDescription && message.getDescription();
        return [code, text].filter(Boolean).join(': ') || 'Transaction declined';
    }

    return 'Transaction declined';
};

const extractNumericStringList = value => {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.filter(Boolean);
    }

    if (value.getNumericString && Array.isArray(value.getNumericString())) {
        return value.getNumericString().filter(Boolean);
    }

    if (Array.isArray(value.numericString)) {
        return value.numericString.filter(Boolean);
    }

    return [];
};

const getPaymentProfileIdFromProfile = profile => {
    const paymentProfiles = (profile && profile.getPaymentProfiles && profile.getPaymentProfiles()) || [];
    const profileList = [].concat(paymentProfiles || []).filter(Boolean);
    const defaultProfile =
        profileList.find(item => item.getDefaultPaymentProfile && item.getDefaultPaymentProfile()) ||
        profileList[0];

    return defaultProfile && defaultProfile.getCustomerPaymentProfileId && defaultProfile.getCustomerPaymentProfileId();
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const toNumber = value => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

const parseDirectResponse = directResponse => {
    if (!directResponse || typeof directResponse !== 'string') {
        return null;
    }

    const parts = directResponse.split(',');
    if (!parts.length) {
        return null;
    }

    return {
        responseCode: parts[0] || '',
        responseSubcode: parts[1] || '',
        responseReasonCode: parts[2] || '',
        responseReasonText: parts[3] || '',
        authCode: parts[4] || '',
        avsResultCode: parts[5] || '',
        transactionId: parts[6] || '',
        invoiceNumber: parts[7] || '',
        description: parts[8] || '',
        amount: parts[9] || '',
        method: parts[10] || '',
        transactionType: parts[11] || '',
        customerId: parts[12] || '',
        firstName: parts[13] || '',
        lastName: parts[14] || '',
        company: parts[15] || '',
        address: parts[16] || '',
        city: parts[17] || '',
        state: parts[18] || '',
        zip: parts[19] || '',
        country: parts[20] || '',
        phone: parts[21] || '',
        fax: parts[22] || '',
        email: parts[23] || '',
        cardType: parts[50] || '',
        accountNumber: parts[51] || ''
    };
};

const createTransaction = async ({ opaqueData, amount, invoiceNumber, description, customer, billTo }) => {
    const merchantAuthenticationType = createMerchantAuthentication();

    const paymentType = new SDK.PaymentType();
    paymentType.setOpaqueData(
        new SDK.OpaqueDataType({
            dataDescriptor: opaqueData.dataDescriptor,
            dataValue: opaqueData.dataValue
        })
    );

    const transactionRequestType = new SDK.TransactionRequestType();
    transactionRequestType.setTransactionType(SDK.TransactionTypeEnum.AUTHCAPTURETRANSACTION);
    transactionRequestType.setPayment(paymentType);
    transactionRequestType.setAmount(amount);

    if (description || invoiceNumber) {
        transactionRequestType.setOrder(
            new SDK.OrderType({
                invoiceNumber,
                description
            })
        );
    }

    if (customer) {
        transactionRequestType.setCustomer(new SDK.CustomerDataType(customer));
    }

    if (billTo) {
        transactionRequestType.setBillTo(new SDK.CustomerAddressType(billTo));
    }

    const request = new SDK.CreateTransactionRequest();
    request.setMerchantAuthentication(merchantAuthenticationType);
    request.setTransactionRequest(transactionRequestType);

    const rawResponse = await execute(SDKController.CreateTransactionController, request);
    const response = new SDK.CreateTransactionResponse(rawResponse);
    const messages = response.getMessages();
    const transactionResponse = response.getTransactionResponse();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    if (!transactionResponse || transactionResponse.getResponseCode() !== '1') {
        throw createGatewayError(response, getTransactionErrorText(transactionResponse));
    }

    return {
        transactionId: transactionResponse.getTransId(),
        authCode: transactionResponse.getAuthCode(),
        responseCode: transactionResponse.getResponseCode(),
        accountNumber: transactionResponse.getAccountNumber(),
        accountType: transactionResponse.getAccountType(),
        networkTransId: transactionResponse.getNetworkTransId && transactionResponse.getNetworkTransId()
    };
};

const createCustomerProfileFromTransaction = async ({ transactionId, merchantCustomerId, description, email }) => {
    const request = new SDK.CreateCustomerProfileFromTransactionRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    request.setTransId(transactionId);
    request.setCustomer(
        new SDK.CustomerProfileBaseType({
            merchantCustomerId,
            description,
            email
        })
    );
    request.setDefaultPaymentProfile(true);

    const rawResponse = await execute(SDKController.CreateCustomerProfileFromTransactionController, request);
    const response = new SDK.CreateCustomerProfileResponse(rawResponse);
    const messages = response.getMessages();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    const paymentProfileList = response.getCustomerPaymentProfileIdList();

    return {
        customerProfileId: response.getCustomerProfileId(),
        customerPaymentProfileId: Array.isArray(paymentProfileList) ? paymentProfileList[0] : paymentProfileList && paymentProfileList.numericString && paymentProfileList.numericString[0]
    };
};

const createCustomerProfile = async ({ merchantCustomerId, description, email, opaqueData, billTo }) => {
    const request = new SDK.CreateCustomerProfileRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    const profilePayload = {
        merchantCustomerId,
        description,
        email
    };

    if (opaqueData) {
        profilePayload.paymentProfiles = [
            {
                billTo,
                payment: {
                    opaqueData: {
                        dataDescriptor: opaqueData.dataDescriptor,
                        dataValue: opaqueData.dataValue
                    }
                },
                defaultPaymentProfile: true
            }
        ];
    }

    request.setProfile(new SDK.CustomerProfileType(profilePayload));

    const rawResponse = await execute(SDKController.CreateCustomerProfileController, request);
    const response = new SDK.CreateCustomerProfileResponse(rawResponse);
    const messages = response.getMessages();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    const customerProfileId = response.getCustomerProfileId();
    let customerPaymentProfileId = extractNumericStringList(response.getCustomerPaymentProfileIdList())[0];

    if (!customerPaymentProfileId && customerProfileId && opaqueData) {
        for (let attempt = 0; attempt < 5 && !customerPaymentProfileId; attempt++) {
            if (attempt > 0) {
                await sleep(300);
            }

            const profile = await getCustomerProfile(customerProfileId);
            customerPaymentProfileId = getPaymentProfileIdFromProfile(profile);
        }
    }

    return {
        customerProfileId,
        customerPaymentProfileId
    };
};

const createTransactionFromCustomerProfile = async ({
    amount,
    customerProfileId,
    customerPaymentProfileId,
    invoiceNumber,
    description
}) => {
    const request = new SDK.CreateCustomerProfileTransactionRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    request.setTransaction(
        new SDK.ProfileTransactionType({
            profileTransAuthCapture: {
                amount,
                customerProfileId,
                customerPaymentProfileId,
                order: {
                    invoiceNumber,
                    description
                }
            }
        })
    );

    const rawResponse = await execute(SDKController.CreateCustomerProfileTransactionController, request);
    const response = new SDK.CreateCustomerProfileTransactionResponse(rawResponse);
    const messages = response.getMessages();
    const transactionResponse = response.getTransactionResponse();
    const directResponse = parseDirectResponse(response.getDirectResponse && response.getDirectResponse());

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    if (transactionResponse && transactionResponse.getResponseCode() === '1') {
        return {
            transactionId: transactionResponse.getTransId(),
            authCode: transactionResponse.getAuthCode(),
            responseCode: transactionResponse.getResponseCode(),
            accountNumber: transactionResponse.getAccountNumber(),
            accountType: transactionResponse.getAccountType(),
            networkTransId: transactionResponse.getNetworkTransId && transactionResponse.getNetworkTransId()
        };
    }

    if (directResponse && directResponse.responseCode === '1') {
        return {
            transactionId: directResponse.transactionId,
            authCode: directResponse.authCode,
            responseCode: directResponse.responseCode,
            accountNumber: directResponse.accountNumber,
            accountType: directResponse.cardType,
            networkTransId: null
        };
    }

    throw createGatewayError(response, (directResponse && directResponse.responseReasonText) || getTransactionErrorText(transactionResponse));
};

const createCustomerPaymentProfile = async ({ customerProfileId, opaqueData, billTo, setAsDefault }) => {
    const request = new SDK.CreateCustomerPaymentProfileRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    request.setCustomerProfileId(customerProfileId);
    request.setPaymentProfile(
        new SDK.CustomerPaymentProfileType({
            billTo,
            payment: {
                opaqueData: {
                    dataDescriptor: opaqueData.dataDescriptor,
                    dataValue: opaqueData.dataValue
                }
            },
            defaultPaymentProfile: Boolean(setAsDefault)
        })
    );
    request.setValidationMode('testMode');

    const rawResponse = await execute(SDKController.CreateCustomerPaymentProfileController, request);
    const response = new SDK.CreateCustomerPaymentProfileResponse(rawResponse);
    const messages = response.getMessages();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    return {
        customerProfileId: response.getCustomerProfileId(),
        customerPaymentProfileId: response.getCustomerPaymentProfileId()
    };
};

const getCustomerProfile = async customerProfileId => {
    const request = new SDK.GetCustomerProfileRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    request.setCustomerProfileId(customerProfileId);

    const rawResponse = await execute(SDKController.GetCustomerProfileController, request);
    const response = new SDK.GetCustomerProfileResponse(rawResponse);
    const messages = response.getMessages();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    return response.getProfile();
};

const createSubscription = async ({ name, amount, customerProfileId, customerPaymentProfileId, intervalLength, intervalUnit, startDate, totalOccurrences }) => {
    const paymentSchedule = new SDK.PaymentScheduleType({
        interval: {
            length: intervalLength,
            unit: intervalUnit
        },
        startDate,
        totalOccurrences,
        trialOccurrences: 0
    });

    const subscription = new SDK.ARBSubscriptionType({
        name,
        paymentSchedule,
        amount,
        trialAmount: 0,
        profile: {
            customerProfileId,
            customerPaymentProfileId
        }
    });

    const request = new SDK.ARBCreateSubscriptionRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    request.setSubscription(subscription);

    const rawResponse = await execute(SDKController.ARBCreateSubscriptionController, request);
    const response = new SDK.ARBCreateSubscriptionResponse(rawResponse);
    const messages = response.getMessages();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    return {
        subscriptionId: response.getSubscriptionId()
    };
};

const getSubscription = async subscriptionId => {
    const request = new SDK.ARBGetSubscriptionRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    request.setSubscriptionId(subscriptionId);
    request.setIncludeTransactions(true);

    const rawResponse = await execute(SDKController.ARBGetSubscriptionController, request);
    const response = new SDK.ARBGetSubscriptionResponse(rawResponse);
    const messages = response.getMessages();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    return response.getSubscription();
};

const getSubscriptionStatus = async subscriptionId => {
    const request = new SDK.ARBGetSubscriptionStatusRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    request.setSubscriptionId(subscriptionId);

    const rawResponse = await execute(SDKController.ARBGetSubscriptionStatusController, request);
    const response = new SDK.ARBGetSubscriptionStatusResponse(rawResponse);
    const messages = response.getMessages();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    return response.getStatus();
};

const listSubscriptions = async ({
    searchType = SDK.ARBGetSubscriptionListSearchTypeEnum.SUBSCRIPTIONACTIVE,
    page = 1,
    limit = 100,
    orderBy = SDK.ARBGetSubscriptionListOrderFieldEnum.CREATETIMESTAMPUTC,
    orderDescending = true
} = {}) => {
    const request = new SDK.ARBGetSubscriptionListRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    request.setSearchType(searchType);
    request.setSorting(
        new SDK.ARBGetSubscriptionListSorting({
            orderBy,
            orderDescending: Boolean(orderDescending)
        })
    );
    request.setPaging(
        new SDK.Paging({
            limit,
            offset: page
        })
    );

    const rawResponse = await execute(SDKController.ARBGetSubscriptionListController, request);
    const response = new SDK.ARBGetSubscriptionListResponse(rawResponse);
    const messages = response.getMessages();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    const detailsWrapper = response.getSubscriptionDetails && response.getSubscriptionDetails();
    const detailList = (detailsWrapper && detailsWrapper.getSubscriptionDetail && detailsWrapper.getSubscriptionDetail()) || [];

    return [].concat(detailList || []).map(detail => ({
        subscriptionId: detail.getId && detail.getId(),
        name: detail.getName && detail.getName(),
        status: detail.getStatus && detail.getStatus(),
        createTimeStampUTC: detail.getCreateTimeStampUTC && detail.getCreateTimeStampUTC(),
        amount: toNumber(detail.getAmount && detail.getAmount()),
        customerProfileId: detail.getCustomerProfileId && detail.getCustomerProfileId(),
        customerPaymentProfileId: detail.getCustomerPaymentProfileId && detail.getCustomerPaymentProfileId()
    }));
};

const findSubscriptionByCustomerProfile = async ({
    customerProfileId,
    customerPaymentProfileId,
    expectedAmount,
    expectedName
}) => {
    if (!customerProfileId) {
        return null;
    }

    const searchTypes = [
        SDK.ARBGetSubscriptionListSearchTypeEnum.SUBSCRIPTIONACTIVE,
        SDK.ARBGetSubscriptionListSearchTypeEnum.SUBSCRIPTIONINACTIVE
    ];
    const normalizedExpectedName = (expectedName || '').trim().toLowerCase();
    const normalizedExpectedAmount = toNumber(expectedAmount);
    const candidates = [];

    for (const searchType of searchTypes) {
        const subscriptions = await listSubscriptions({ searchType });
        subscriptions.forEach(subscription => {
            if (subscription.customerProfileId !== customerProfileId) {
                return;
            }

            if (
                customerPaymentProfileId &&
                subscription.customerPaymentProfileId &&
                subscription.customerPaymentProfileId !== customerPaymentProfileId
            ) {
                return;
            }

            candidates.push(subscription);
        });
    }

    if (!candidates.length) {
        return null;
    }

    const rankedCandidates = candidates
        .map(candidate => {
            let score = 0;

            if (customerPaymentProfileId && candidate.customerPaymentProfileId === customerPaymentProfileId) {
                score += 5;
            }

            if (normalizedExpectedAmount !== null && candidate.amount === normalizedExpectedAmount) {
                score += 3;
            }

            if (normalizedExpectedName && (candidate.name || '').trim().toLowerCase() === normalizedExpectedName) {
                score += 4;
            }

            if (candidate.status === SDK.ARBSubscriptionStatusEnum.ACTIVE) {
                score += 2;
            }

            return Object.assign({}, candidate, { score });
        })
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }

            return String(right.createTimeStampUTC || '').localeCompare(String(left.createTimeStampUTC || ''));
        });

    return rankedCandidates[0] || null;
};

const updateSubscriptionPaymentProfile = async ({ subscriptionId, customerProfileId, customerPaymentProfileId }) => {
    const request = new SDK.ARBUpdateSubscriptionRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    request.setSubscriptionId(subscriptionId);
    request.setSubscription(
        new SDK.ARBSubscriptionType({
            profile: {
                customerProfileId,
                customerPaymentProfileId
            }
        })
    );

    const rawResponse = await execute(SDKController.ARBUpdateSubscriptionController, request);
    const response = new SDK.ARBUpdateSubscriptionResponse(rawResponse);
    const messages = response.getMessages();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    return true;
};

const cancelSubscription = async subscriptionId => {
    const request = new SDK.ARBCancelSubscriptionRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    request.setSubscriptionId(subscriptionId);

    const rawResponse = await execute(SDKController.ARBCancelSubscriptionController, request);
    const response = new SDK.ARBCancelSubscriptionResponse(rawResponse);
    const messages = response.getMessages();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    return true;
};

const deleteCustomerPaymentProfile = async ({ customerProfileId, customerPaymentProfileId }) => {
    const request = new SDK.DeleteCustomerPaymentProfileRequest();
    request.setMerchantAuthentication(createMerchantAuthentication());
    request.setCustomerProfileId(customerProfileId);
    request.setCustomerPaymentProfileId(customerPaymentProfileId);

    const rawResponse = await execute(SDKController.DeleteCustomerPaymentProfileController, request);
    const response = new SDK.DeleteCustomerPaymentProfileResponse(rawResponse);
    const messages = response.getMessages();

    if (!(messages && messages.getResultCode && messages.getResultCode() === SDK.MessageTypeEnum.OK)) {
        throw createGatewayError(response);
    }

    return true;
};

module.exports = {
    SDK,
    createCustomerPaymentProfile,
    createCustomerProfile,
    createCustomerProfileFromTransaction,
    createTransactionFromCustomerProfile,
    createSubscription,
    createTransaction,
    cancelSubscription,
    deleteCustomerPaymentProfile,
    getCustomerProfile,
    findSubscriptionByCustomerProfile,
    listSubscriptions,
    getSubscription,
    getSubscriptionStatus,
    updateSubscriptionPaymentProfile
};
