'use strict';

const express = require('express');
const router = new express.Router();
const config = require('wild-config');
const Joi = require('joi');
const apiClient = require('../lib/api-client');
const billingStore = require('../lib/billing-store');
const authorizeNet = require('../lib/authorize-net');
const { getPlan, listPlans } = require('../lib/billing-plans');
const roleBasedAddresses = require('role-based-email-addresses');
/* ------------------------------
   SAFE STRIPE INITIALIZATION
--------------------------------*/

let stripe = null;

const reservedUsernames = new Set(['abuse', 'admin', 'administrator', 'hostmaster', 'majordomo', 'postmaster', 'root', 'ssl-admin', 'webmaster']);
const usernamePattern = /^[a-z0-9][a-z0-9.-]*$/i;

const getServiceDomain = () => (config.service && config.service.domain) || config.serviceDomain || 'yoover.com';

const checkoutSchema = Joi.object({
    requestedUsername: Joi.string().trim().lowercase().required(),
    fullName: Joi.string().trim().min(2).max(120).required(),
    recoveryEmail: Joi.string().trim().email().required(),
    billingEmail: Joi.string().trim().email().required(),
    password: Joi.string().min(8).max(256).required(),
    password2: Joi.string().valid(Joi.ref('password')).required(),
    selectedPlan: Joi.string().valid('monthly', 'yearly').required(),
    company: Joi.string().trim().allow('').max(120).default(''),
    addressLine1: Joi.string().trim().min(3).max(120).required(),
    addressLine2: Joi.string().trim().allow('').max(120).default(''),
    city: Joi.string().trim().min(2).max(80).required(),
    state: Joi.string().trim().min(2).max(80).required(),
    zip: Joi.string().trim().min(3).max(20).required(),
    country: Joi.string().trim().length(2).uppercase().required(),
    dataDescriptor: Joi.string().trim().required(),
    dataValue: Joi.string().trim().required()
});

const validateRequestedUsername = username => {
    const normalizedUsername = (username || '').trim().toLowerCase();

    if (!normalizedUsername) {
        return 'Username is required';
    }

    if (normalizedUsername.length < 3) {
        return 'Username must be at least 3 characters';
    }

    if (!usernamePattern.test(normalizedUsername)) {
        return 'Only letters, numbers, dots, and hyphens are allowed';
    }

    if (
        !config.service.enableSpecial &&
        (reservedUsernames.has(normalizedUsername) || roleBasedAddresses.includes(normalizedUsername))
    ) {
        return `"${normalizedUsername}" is a reserved username`;
    }

    return false;
};

const getPlanOptions = selectedPlan =>
    listPlans().map(plan => ({
        code: plan.code,
        name: plan.name,
        price: plan.formattedPrice,
        summary: plan.summary,
        selected: plan.code === (selectedPlan || 'monthly')
    }));

const splitName = fullName => {
    const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
    return {
        firstName: parts.shift() || '',
        lastName: parts.join(' ') || '.'
    };
};

const addBillingCycle = (date, plan) => {
    const nextDate = new Date(date);
    nextDate.setUTCMonth(nextDate.getUTCMonth() + plan.intervalLength);
    return nextDate;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const buildAuthorizeMerchantCustomerId = username => {
    const cleanedUsername = String(username || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8);
    const shortTimestamp = Date.now().toString(36).slice(-8);

    return `wd-${cleanedUsername || 'acct'}-${shortTimestamp}`.slice(0, 20);
};

const buildAuthorizeSubscriptionName = (username, planName) =>
    `${username}@${getServiceDomain()} ${planName}`.slice(0, 50);

const createSubscriptionWithRetry = async subscriptionPayload => {
    let lastError;

    for (let attempt = 0; attempt < 8; attempt++) {
        try {
            if (attempt > 0) {
                await sleep(1500 * attempt);
            }

            await ensurePaymentProfileReady({
                customerProfileId: subscriptionPayload.customerProfileId,
                customerPaymentProfileId: subscriptionPayload.customerPaymentProfileId
            });

            return await authorizeNet.createSubscription(subscriptionPayload);
        } catch (err) {
            lastError = err;

            if (!/record cannot be found/i.test((err && err.message) || '')) {
                throw err;
            }
        }
    }

    throw lastError;
};

const createProfileTransactionWithRetry = async transactionPayload => {
    let lastError;

    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            if (attempt > 0) {
                await sleep(800 * attempt);
            }

            return await authorizeNet.createTransactionFromCustomerProfile(transactionPayload);
        } catch (err) {
            lastError = err;

            if (!/customer profile id or customer payment profile id not found/i.test((err && err.message) || '')) {
                throw err;
            }
        }
    }

    throw lastError;
};

const isRetryableSubscriptionSetupError = err =>
    /record cannot be found|sandbox has not finished attaching the payment profile/i.test((err && err.message) || '');

const ensurePaymentProfileReady = async ({ customerProfileId, customerPaymentProfileId }) => {
    for (let attempt = 0; attempt < 8; attempt++) {
        if (attempt > 0) {
            await sleep(1200 * attempt);
        }

        const profile = await authorizeNet.getCustomerProfile(customerProfileId);
        const paymentProfiles = (profile && profile.getPaymentProfiles && profile.getPaymentProfiles()) || [];
        const paymentProfileList = [].concat(paymentProfiles || []).filter(Boolean);
        const match = paymentProfileList.find(item => {
            const paymentProfileId = item.getCustomerPaymentProfileId && item.getCustomerPaymentProfileId();
            return paymentProfileId === customerPaymentProfileId;
        });

        if (match) {
            return true;
        }
    }

    throw new Error('Authorize.Net sandbox has not finished attaching the payment profile yet. Please try again in a moment.');
};

const normalizeMaskedPaymentProfiles = profile => {
    const paymentProfiles = (profile && profile.getPaymentProfiles && profile.getPaymentProfiles()) || [];

    return [].concat(paymentProfiles || []).map(paymentProfile => {
        const payment = paymentProfile && paymentProfile.getPayment && paymentProfile.getPayment();
        const creditCard = payment && payment.getCreditCard && payment.getCreditCard();
        const billTo = paymentProfile && paymentProfile.getBillTo && paymentProfile.getBillTo();

        return {
            customerPaymentProfileId: paymentProfile.getCustomerPaymentProfileId(),
            defaultPaymentProfile: Boolean(paymentProfile.getDefaultPaymentProfile && paymentProfile.getDefaultPaymentProfile()),
            cardType: (creditCard && creditCard.getCardType && creditCard.getCardType()) || '',
            cardNumber: (creditCard && creditCard.getCardNumber && creditCard.getCardNumber()) || '',
            expirationDate: (creditCard && creditCard.getExpirationDate && creditCard.getExpirationDate()) || '',
            billTo: {
                firstName: (billTo && billTo.getFirstName && billTo.getFirstName()) || '',
                lastName: (billTo && billTo.getLastName && billTo.getLastName()) || '',
                company: (billTo && billTo.getCompany && billTo.getCompany()) || '',
                address: (billTo && billTo.getAddress && billTo.getAddress()) || '',
                city: (billTo && billTo.getCity && billTo.getCity()) || '',
                state: (billTo && billTo.getState && billTo.getState()) || '',
                zip: (billTo && billTo.getZip && billTo.getZip()) || '',
                country: (billTo && billTo.getCountry && billTo.getCountry()) || '',
                phoneNumber: (billTo && billTo.getPhoneNumber && billTo.getPhoneNumber()) || ''
            }
        };
    });
};

const renderCheckout = (req, res, values, options) =>
    res.render('authorize-signup', {
        title: 'Complete Your Registration',
        activePurchase: true,
        authorizeApiLoginID: process.env.AUTHORIZE_API_LOGIN_ID,
        authorizeClientKey: process.env.AUTHORIZE_CLIENT_KEY,
        requestedUsername: values.requestedUsername,
        values,
        errors: options.errors || {},
        plans: getPlanOptions(values.selectedPlan),
        csrfToken: req.csrfToken(),
        serviceDomain: getServiceDomain()
    });

const createWildDuckAccount = (req, accountData) =>
    new Promise((resolve, reject) => {
        apiClient.users.create(
            {
                name: accountData.fullName,
                username: accountData.requestedUsername,
                password: accountData.password,
                allowUnsafe: true,
                address: `${accountData.requestedUsername}@${getServiceDomain()}`,
                recipients: config.service.recipients,
                forwards: config.service.forwards,
                quota: config.service.quota * 1024 * 1024,
                sess: req.session.id,
                ip: req.ip
            },
            (err, result) => {
                if (err) {
                    return reject(err);
                }

                return resolve(result);
            }
        );
    });

const formatDate = value => {
    if (!value) {
        return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
};

if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('Stripe initialized');
} else {
    console.warn('Stripe key missing - Stripe disabled');
}

/* --- 1. CORE PAGES --- */

// Home
router.get('/', (req, res) => {
    res.render('index', {
        isHome: true,
        title: 'Home',
        serviceDomain: getServiceDomain()
    });
});

// Purchase Page
router.get('/purchase', (req, res) => {
    const requestedUsername = (req.query.username || '').trim().toLowerCase();

    if (!requestedUsername) {
        return res.redirect('/');
    }

    return renderCheckout(
        req,
        res,
        {
            requestedUsername,
            fullName: '',
            recoveryEmail: '',
            billingEmail: '',
            password: '',
            password2: '',
            selectedPlan: req.query.plan === 'yearly' ? 'yearly' : 'monthly',
            company: '',
            addressLine1: '',
            addressLine2: '',
            city: '',
            state: '',
            zip: '',
            country: 'US'
        },
        {}
    );
});

router.get('/purchase/:plan', (req, res) => {
    const plan = getPlan(req.params.plan);
    const username = (req.query.username || '').trim().toLowerCase();

    return res.redirect(`/purchase?username=${encodeURIComponent(username)}&plan=${plan.code}`);
});

router.get('/success', async (req, res) => {
    if (req.query.account) {
        const billingAccount = await billingStore.getAccountByEmail(req.query.account);

        if (!billingAccount) {
            return res.redirect('/');
        }

        return res.render('success', {
            title: 'Payment Successful',
            customerName: billingAccount.fullName,
            newEmail: billingAccount.emailAddress,
            selectedPlan: billingAccount.plan && billingAccount.plan.name,
            nextBillingAt: billingAccount.subscription && formatDate(billingAccount.subscription.nextBillingAt),
            subscriptionStatus: billingAccount.subscription && billingAccount.subscription.status,
            subscriptionActive: billingAccount.subscription && billingAccount.subscription.status === 'active',
            setupStatus: billingAccount.status,
            serviceDomain: getServiceDomain()
        });
    }

    if (!stripe) {
        return res.redirect('/');
    }

    const sessionId = req.query.session_id;

    if (!sessionId) {
        return res.redirect('/');
    }

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        res.render('success', {
            title: 'Payment Successful',
            customerName: session.metadata.fullName,
            newEmail: `${session.metadata.username}@${getServiceDomain()}`,
            serviceDomain: getServiceDomain()
        });
    } catch (err) {
        console.error('Stripe Retrieve Error:', err);
        res.redirect('/');
    }
});

// Stripe Purchase Page
router.get('/purchase-email-subscription', (req, res) => {

    res.render('stripe-test', {
        title: 'Stripe Purchase',
        activePurchase: true,
        testUsername: 'tester' + Math.floor(Math.random() * 100),
        serviceDomain: getServiceDomain(),
        stripePublicKey: process.env.STRIPE_PUBLISHABLE_KEY,
        csrfToken: req.csrfToken()
    });
});

/* --- 2. STRIPE CHECKOUT --- */

router.post('/create-checkout-session', async (req, res) => {

    if (!stripe) {
        return res.status(500).send('Stripe is not configured');
    }

    const { requestedUsername, fullName, recoveryEmail } = req.body;

    try {

        const session = await stripe.checkout.sessions.create({

            payment_method_types: ['card'],

            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Professional Email: ${requestedUsername}@${getServiceDomain()}`,
                        description: `Secure account for ${fullName}`
                    },
                    unit_amount: 1500
                },
                quantity: 1
            }],

            mode: 'payment',

            metadata: {
                username: requestedUsername,
                fullName,
                recoveryEmail
            },

            success_url: `${req.protocol}://${req.get('host')}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.protocol}://${req.get('host')}/purchase?username=${requestedUsername}`

        });

        res.redirect(303, session.url);

    } catch (err) {

        console.error('Stripe Session Error:', err);
        res.status(500).send('Stripe Integration Error');

    }

});

/* --- 3. SUPPORT PAGES --- */

router.get('/contact', (req, res) => {

    res.render('contact', {
        title: 'Contact Us',
        activeContact: true,
        serviceDomain: getServiceDomain()
    });

});

router.post('/contact', (req, res) => {

    const { name, email, subject } = req.body;

    console.log(`Contact Submission: ${name} <${email}> - ${subject}`);

    req.flash('success', 'Your message has been received!');
    res.redirect('/contact');

});

router.get('/pricing', (req, res) => {

    res.render('pricing', {
        title: 'Pricing',
        activePurchase: true,
        serviceDomain: getServiceDomain()
    });

});

router.get('/terms', (req, res) => {

    res.render('terms', {
        title: 'Terms of Service',
        serviceDomain: getServiceDomain()
    });

});

router.get('/privacy', (req, res) => {

    res.render('policy', {
        title: 'Privacy Policy',
        serviceDomain: getServiceDomain()
    });

});

router.get('/help', (req, res) => {

    res.render('help', {
        title: 'Help',
        activeHelp: true,
        setup: config.setup,
        serviceDomain: getServiceDomain(),
        use2fa:
            res.locals.user &&
            res.locals.user.enabled2fa &&
            res.locals.user.enabled2fa.length
    });

});

/* --- 4. API PROXIES --- */

router.get('/check-username', async (req, res) => {
    const username = (req.query.username || '').trim().toLowerCase();
    const validationError = validateRequestedUsername(username);

    if (validationError) {
        return res.status(400).json({
            error: validationError
        });
    }

    try {
        return apiClient.users.resolve(
            {
                username: `${username}@${getServiceDomain()}`,
                ip: req.ip,
                sess: req.session.id
            },
            err => {
                if (!err) {
                    return res.json({ available: false });
                }

                if (err.statusCode === 404) {
                    return res.json({ available: true });
                }

                console.error('WildDuck Check Error:', err);
                return res.status(500).json({
                    error: 'API Connection Failed'
                });
            }
        );
    } catch (err) {
        console.error('WildDuck Check Error:', err);
        res.status(500).json({
            error: 'API Connection Failed'
        });
    }
});



router.get('/purchase-authorize', (req, res) => {
    return res.redirect(`/purchase?username=${encodeURIComponent((req.query.username || '').trim().toLowerCase())}`);
});

router.post('/execute-authorize-payment', async (req, res) => {
    const payload = Object.assign({}, req.body);
    delete payload._csrf;

    try {
        const result = checkoutSchema.validate(payload, {
            abortEarly: false,
            convert: true,
            allowUnknown: false
        });

        const formValues = Object.assign(
            {
                company: '',
                addressLine2: ''
            },
            payload,
            (result && result.value) || {}
        );

        if (result.error) {
            const errors = {};
            result.error.details.forEach(detail => {
                errors[detail.path] = detail.message;
            });
            return renderCheckout(req, res, formValues, { errors });
        }

        const values = result.value;
        const validationError = validateRequestedUsername(values.requestedUsername);
        if (validationError) {
            return renderCheckout(req, res, values, {
                errors: {
                    requestedUsername: validationError
                }
            });
        }

        const usernameAvailable = await new Promise((resolve, reject) => {
            apiClient.users.resolve(
                {
                    username: `${values.requestedUsername}@${getServiceDomain()}`,
                    ip: req.ip,
                    sess: req.session.id
                },
                err => {
                    if (!err) {
                        return resolve(false);
                    }

                    if (err.statusCode === 404) {
                        return resolve(true);
                    }

                    return reject(err);
                }
            );
        });

        if (!usernameAvailable) {
            return renderCheckout(req, res, values, {
                errors: {
                    requestedUsername: 'That username is no longer available. Please choose another one.'
                }
            });
        }

        const existingAccount = await billingStore.getAccountByEmail(`${values.requestedUsername}@${getServiceDomain()}`);
        if (existingAccount && existingAccount.status !== 'canceled') {
            return renderCheckout(req, res, values, {
                errors: {
                    requestedUsername: 'A billing profile already exists for this address.'
                }
            });
        }

        const plan = getPlan(values.selectedPlan);
        const name = splitName(values.fullName);
        const initialChargeDate = new Date();
        const nextBillingAt = addBillingCycle(initialChargeDate, plan);
        const merchantCustomerId = buildAuthorizeMerchantCustomerId(values.requestedUsername);
        const invoiceNumber = `INV-${Date.now()}`;
        const billTo = {
            firstName: name.firstName,
            lastName: name.lastName,
            company: values.company,
            address: values.addressLine1,
            city: values.city,
            state: values.state,
            zip: values.zip,
            country: values.country
        };

        const profileIds = await authorizeNet.createCustomerProfile({
            merchantCustomerId,
            description: `${values.fullName} billing profile`,
            email: values.billingEmail,
            opaqueData: {
                dataDescriptor: values.dataDescriptor,
                dataValue: values.dataValue
            },
            billTo
        });

        if (!profileIds.customerProfileId || !profileIds.customerPaymentProfileId) {
            throw new Error('Unable to attach the sandbox payment profile. Please try again with a fresh checkout attempt.');
        }

        const transaction = await createProfileTransactionWithRetry({
            amount: plan.price,
            customerProfileId: profileIds.customerProfileId,
            customerPaymentProfileId: profileIds.customerPaymentProfileId,
            invoiceNumber,
            description: `${plan.name} plan for ${values.requestedUsername}@${getServiceDomain()}`
        });

        const customerProfile = await authorizeNet.getCustomerProfile(profileIds.customerProfileId);
        const paymentMethods = normalizeMaskedPaymentProfiles(customerProfile);

        let subscription = null;
        let subscriptionStatus = 'pending_activation';
        let accountStatus = 'payment-captured';
        let subscriptionSetupNote = '';

        try {
            await ensurePaymentProfileReady({
                customerProfileId: profileIds.customerProfileId,
                customerPaymentProfileId: profileIds.customerPaymentProfileId
            });

            subscription = await createSubscriptionWithRetry({
                name: buildAuthorizeSubscriptionName(values.requestedUsername, plan.name),
                amount: plan.price,
                customerProfileId: profileIds.customerProfileId,
                customerPaymentProfileId: profileIds.customerPaymentProfileId,
                intervalLength: plan.intervalLength,
                intervalUnit: plan.intervalUnit,
                startDate: nextBillingAt.toISOString().slice(0, 10),
                totalOccurrences: 9999
            });

            subscriptionStatus = 'active';
        } catch (subscriptionErr) {
            if (!isRetryableSubscriptionSetupError(subscriptionErr)) {
                throw subscriptionErr;
            }

            subscriptionSetupNote = subscriptionErr.message || 'Subscription activation is still syncing with Authorize.Net sandbox.';
            console.warn('Authorize Subscription Pending:', subscriptionSetupNote);
        }

        let billingAccount = await billingStore.upsertAccount({
            username: values.requestedUsername,
            emailAddress: `${values.requestedUsername}@${getServiceDomain()}`,
            fullName: values.fullName,
            billingEmail: values.billingEmail,
            recoveryEmail: values.recoveryEmail,
            wildduckUserId: null,
            plan,
            status: accountStatus,
            authorizeNet: {
                customerProfileId: profileIds.customerProfileId,
                customerPaymentProfileId: profileIds.customerPaymentProfileId,
                subscriptionId: subscription && subscription.subscriptionId
            },
            paymentMethods,
            subscription: {
                id: subscription && subscription.subscriptionId,
                status: subscriptionStatus,
                startedAt: initialChargeDate,
                nextBillingAt: subscription ? nextBillingAt : null,
                currentPeriodEndsAt: subscription ? nextBillingAt : null,
                canceledAt: null
            },
            meta: {
                merchantCustomerId,
                invoiceNumber,
                subscriptionSetupNote
            }
        });

        await billingStore.recordPayment({
            accountId: billingAccount._id,
            emailAddress: billingAccount.emailAddress,
            username: billingAccount.username,
            transactionId: transaction.transactionId,
            subscriptionId: subscription && subscription.subscriptionId,
            amount: plan.price,
            status: 'paid',
            type: 'initial',
            cardNumber: transaction.accountNumber,
            cardType: transaction.accountType,
            authCode: transaction.authCode
        });

        try {
            const wildDuckUser = await createWildDuckAccount(req, values);

            billingAccount = await billingStore.upsertAccount(
                Object.assign({}, billingAccount, {
                    wildduckUserId: wildDuckUser && wildDuckUser.id,
                    status: subscription ? 'active' : 'active-pending-billing'
                })
            );
        } catch (provisionErr) {
            console.error('Mailbox Provisioning Error:', provisionErr);
            req.flash('warning', 'Payment was successful, but mailbox provisioning needs manual review. Support can help using your billing email.');
            return res.redirect(`/success?account=${encodeURIComponent(billingAccount.emailAddress)}`);
        }

        if (!subscription) {
            req.flash('warning', 'Your payment was successful and your mailbox is ready. Recurring billing activation is still syncing in Authorize.Net sandbox.');
        }

        return res.redirect(`/success?account=${encodeURIComponent(billingAccount.emailAddress)}`);
    } catch (err) {
        console.error('Authorize Checkout Error:', err);
        req.flash('danger', err.message || 'Unable to complete your payment right now.');
        return renderCheckout(
            req,
            res,
            {
                requestedUsername: (payload.requestedUsername || '').trim().toLowerCase(),
                fullName: payload.fullName || '',
                recoveryEmail: payload.recoveryEmail || '',
                billingEmail: payload.billingEmail || '',
                password: '',
                password2: '',
                selectedPlan: payload.selectedPlan || 'monthly',
                company: payload.company || '',
                addressLine1: payload.addressLine1 || '',
                addressLine2: payload.addressLine2 || '',
                city: payload.city || '',
                state: payload.state || '',
                zip: payload.zip || '',
                country: payload.country || 'US'
            },
            {
                errors: {}
            }
        );
    }
});

module.exports = router;
