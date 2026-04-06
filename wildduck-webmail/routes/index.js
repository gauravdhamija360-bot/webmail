'use strict';

const express = require('express');
const router = new express.Router();
const config = require('wild-config');
const Joi = require('joi');
const apiClient = require('../lib/api-client');
const billingStore = require('../lib/billing-store');
const authorizeNet = require('../lib/authorize-net');
const adminNotifier = require('../lib/admin-notifier');
const db = require('../lib/db');
const { getDefaultPlan, getPlan, listPlans } = require('../lib/billing-plans');
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
    selectedPlan: Joi.string().trim().lowercase().required(),
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

const testSignupSchema = Joi.object({
    requestedUsername: Joi.string().trim().lowercase().required(),
    fullName: Joi.string().trim().min(2).max(120).required(),
    recoveryEmail: Joi.string().trim().email().allow('').default(''),
    password: Joi.string().min(8).max(256).required(),
    password2: Joi.string().valid(Joi.ref('password')).required()
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

const resolveUser = (username, req) =>
    new Promise((resolve, reject) => {
        apiClient.users.resolve(
            {
                username,
                ip: req.ip,
                sess: req.session.id
            },
            (err, result) => {
                if (!err) {
                    return resolve(result || null);
                }

                if (err.statusCode === 404) {
                    return resolve(null);
                }

                return reject(err);
            }
        );
    });

const findClaimedIdentity = async (requestedUsername, req) => {
    const normalizedUsername = String(requestedUsername || '').trim().toLowerCase();
    const emailAddress = `${normalizedUsername}@${getServiceDomain()}`;

    const [billingByEmail, billingByUsername] = await Promise.all([
        billingStore.getAccountByEmail(emailAddress),
        billingStore.getAccountByUsername(normalizedUsername)
    ]);

    const activeBillingAccount = [billingByEmail, billingByUsername].find(
        account => account && account.status !== 'canceled'
    );

    if (activeBillingAccount) {
        return activeBillingAccount;
    }

    if (db.mongo) {
        const mailboxUser = await db.collection('users').findOne({
            $or: [{ address: emailAddress }, { username: normalizedUsername }, { username: emailAddress }]
        });

        if (mailboxUser) {
            return mailboxUser;
        }
    }

    return (
        (await resolveUser(emailAddress, req)) ||
        (normalizedUsername !== emailAddress ? await resolveUser(normalizedUsername, req) : null)
    );
};

const isUsernameAvailable = async (requestedUsername, req) => !(await findClaimedIdentity(requestedUsername, req));

const getPlanOptions = async selectedPlan => {
    const plans = await listPlans();
    const defaultPlan = plans.find(plan => plan.featured) || plans[0];
    const selectedCode = selectedPlan || (defaultPlan && defaultPlan.code);

    return plans.map(plan => ({
        code: plan.code,
        name: plan.name,
        price: plan.formattedPrice,
        billingLabel: plan.billingLabel,
        summary: plan.summary,
        benefits: plan.benefits || [],
        selected: plan.code === selectedCode
    }));
};

const splitName = fullName => {
    const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
    return {
        firstName: parts.shift() || '',
        lastName: parts.join(' ') || '.'
    };
};

const addBillingCycle = (date, plan) => {
    const nextDate = new Date(date);
    const intervalLength = Number(plan && plan.intervalLength) || 1;
    const intervalUnit = String((plan && plan.intervalUnit) || 'months').toLowerCase();

    if (intervalUnit === 'days') {
        nextDate.setUTCDate(nextDate.getUTCDate() + intervalLength);
        return nextDate;
    }

    nextDate.setUTCMonth(nextDate.getUTCMonth() + intervalLength);
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

const pendingSubscriptionRecovery = new Set();

const createSubscriptionWithRetry = async subscriptionPayload => {
    let lastError;

    for (let attempt = 0; attempt < 8; attempt++) {
        try {
            if (attempt > 0) {
                await sleep(1500 * attempt);
            }

            return await authorizeNet.createSubscription(subscriptionPayload);
        } catch (err) {
            lastError = err;

            if (!/record cannot be found|customer profile id or customer payment profile id not found/i.test((err && err.message) || '')) {
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
    /record cannot be found|customer profile id or customer payment profile id not found/i.test((err && err.message) || '');

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

const recoverPendingSubscriptionForAccount = async emailAddress => {
    if (!emailAddress || pendingSubscriptionRecovery.has(emailAddress)) {
        return null;
    }

    pendingSubscriptionRecovery.add(emailAddress);

    try {
        const billingAccount = await billingStore.getAccountByEmail(emailAddress);

        if (
            !billingAccount ||
            !billingAccount.plan ||
            !billingAccount.authorizeNet ||
            !billingAccount.authorizeNet.customerProfileId ||
            !billingAccount.authorizeNet.customerPaymentProfileId ||
            billingAccount.authorizeNet.subscriptionId
        ) {
            return null;
        }

        const plan = (await getPlan(billingAccount.plan.code || billingAccount.plan)) || billingAccount.plan;
        const expectedName = buildAuthorizeSubscriptionName(billingAccount.username, plan.name);
        const baseDate =
            (billingAccount.subscription && billingAccount.subscription.startedAt) || billingAccount.createdAt || new Date();
        const nextBillingAt = addBillingCycle(baseDate, plan);
        const gatewayProfile = await authorizeNet.getCustomerProfile(billingAccount.authorizeNet.customerProfileId);
        const paymentMethods = normalizeMaskedPaymentProfiles(gatewayProfile);

        let subscription = await authorizeNet.findSubscriptionByCustomerProfile({
            customerProfileId: billingAccount.authorizeNet.customerProfileId,
            customerPaymentProfileId: billingAccount.authorizeNet.customerPaymentProfileId,
            expectedAmount: plan.price,
            expectedName
        });

        if (!subscription) {
            subscription = await createSubscriptionWithRetry({
                name: expectedName,
                amount: plan.price,
                customerProfileId: billingAccount.authorizeNet.customerProfileId,
                customerPaymentProfileId: billingAccount.authorizeNet.customerPaymentProfileId,
                intervalLength: plan.intervalLength,
                intervalUnit: plan.intervalUnit,
                startDate: nextBillingAt.toISOString().slice(0, 10),
                totalOccurrences: 9999
            });
        }

        if (!subscription || !subscription.subscriptionId) {
            return null;
        }

        return billingStore.upsertAccount(
            Object.assign({}, billingAccount, {
                status: billingAccount.wildduckUserId ? 'active' : billingAccount.status,
                authorizeNet: Object.assign({}, billingAccount.authorizeNet, {
                    subscriptionId: subscription.subscriptionId
                }),
                paymentMethods,
                subscription: Object.assign({}, billingAccount.subscription, {
                    id: subscription.subscriptionId,
                    status: subscription.status || 'active',
                    startedAt: (billingAccount.subscription && billingAccount.subscription.startedAt) || billingAccount.createdAt || new Date(),
                    nextBillingAt,
                    currentPeriodEndsAt: nextBillingAt,
                    canceledAt: null
                }),
                meta: Object.assign({}, billingAccount.meta, {
                    subscriptionSetupNote: ''
                })
            })
        );
    } catch (err) {
        const billingAccount = await billingStore.getAccountByEmail(emailAddress);

        if (billingAccount) {
            await billingStore.upsertAccount(
                Object.assign({}, billingAccount, {
                    meta: Object.assign({}, billingAccount.meta, {
                        subscriptionSetupNote: err.message || 'Subscription activation is still syncing with Authorize.Net.'
                    })
                })
            );
        }

        console.warn('Authorize background subscription recovery failed:', err.message || err);
        return null;
    } finally {
        pendingSubscriptionRecovery.delete(emailAddress);
    }
};

const schedulePendingSubscriptionRecovery = (emailAddress, delayMs) => {
    if (!emailAddress) {
        return;
    }

    setTimeout(() => {
        recoverPendingSubscriptionForAccount(emailAddress).catch(err => {
            console.warn('Authorize scheduled subscription recovery failed:', err.message || err);
        });
    }, delayMs);
};

const renderCheckout = async (req, res, values, options) =>
    res.render('authorize-signup', {
        title: 'Complete Your Registration',
        activePurchase: true,
        authorizeApiLoginID: process.env.AUTHORIZE_API_LOGIN_ID,
        authorizeClientKey: process.env.AUTHORIZE_CLIENT_KEY,
        requestedUsername: values.requestedUsername,
        values,
        errors: options.errors || {},
        plans: await getPlanOptions(values.selectedPlan),
        csrfToken: req.csrfToken(),
        serviceDomain: getServiceDomain()
    });

const renderTestSignup = (req, res, values, options) =>
    res.render('test-signup', {
        title: 'Create Test Mailbox',
        activePurchase: true,
        activeTestSignup: true,
        requestedUsername: values.requestedUsername,
        values,
        errors: options.errors || {},
        csrfToken: req.csrfToken(),
        serviceDomain: getServiceDomain()
    });

const redirectCheckout = (req, res, values, options) => {
    req.session.checkoutFormState = {
        values: Object.assign({}, values, {
            password: '',
            password2: ''
        }),
        errors: (options && options.errors) || {}
    };

    const username = values && values.requestedUsername ? String(values.requestedUsername).trim().toLowerCase() : '';
    const plan = values && values.selectedPlan ? values.selectedPlan : 'monthly';

    return res.redirect(`/purchase?username=${encodeURIComponent(username)}&plan=${encodeURIComponent(plan)}`);
};

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
    const hostname = String(req.hostname || '').toLowerCase();
    if (hostname === 'mail.yoover.com') {
        return res.redirect('/account/login');
    }

    const handler = async () =>
        res.render('index', {
        isHome: true,
        title: 'Home',
        pricingPlans: await listPlans(),
        serviceDomain: getServiceDomain()
    });

    return handler().catch(err => {
        console.error('Homepage Plans Error:', err);
        res.render('index', {
            isHome: true,
            title: 'Home',
            pricingPlans: [],
            serviceDomain: getServiceDomain()
        });
    });
});

// Purchase Page
router.get('/purchase', async (req, res) => {
    const requestedUsername = (req.query.username || '').trim().toLowerCase();
    const defaultPlan = await getDefaultPlan();
    const requestedPlan = (req.query.plan || '').trim().toLowerCase();
    const resolvedPlan = await getPlan(requestedPlan || (defaultPlan && defaultPlan.code));
    const selectedPlan = (resolvedPlan && resolvedPlan.code) || (defaultPlan && defaultPlan.code) || 'monthly';
    const checkoutFormState = req.session.checkoutFormState;
    delete req.session.checkoutFormState;

    return renderCheckout(
        req,
        res,
        Object.assign(
            {
                requestedUsername,
                fullName: '',
                recoveryEmail: '',
                billingEmail: '',
                password: '',
                password2: '',
                selectedPlan,
                company: '',
                addressLine1: '',
                addressLine2: '',
                city: '',
                state: '',
                zip: '',
                country: 'US'
            },
            checkoutFormState && checkoutFormState.values ? checkoutFormState.values : {},
            {
                requestedUsername,
                selectedPlan,
                password: '',
                password2: ''
            }
        ),
        {
            errors: (checkoutFormState && checkoutFormState.errors) || {}
        }
    );
});

router.get('/purchase/:plan', (req, res) => {
    const handler = async () => {
        const plan = await getPlan(req.params.plan);
        const username = (req.query.username || '').trim().toLowerCase();
        const defaultPlan = await getDefaultPlan();

        return res.redirect(`/purchase?username=${encodeURIComponent(username)}&plan=${encodeURIComponent((plan && plan.code) || (defaultPlan && defaultPlan.code) || 'monthly')}`);
    };

    return handler().catch(err => {
        console.error('Purchase Plan Redirect Error:', err);
        return res.redirect(`/purchase?username=${encodeURIComponent((req.query.username || '').trim().toLowerCase())}`);
    });
});

router.get('/test-signup', (req, res) => {
    const requestedUsername = (req.query.username || '').trim().toLowerCase();
    const formState = req.session.testSignupFormState;
    delete req.session.testSignupFormState;

    return renderTestSignup(
        req,
        res,
        Object.assign(
            {
                requestedUsername,
                fullName: '',
                recoveryEmail: '',
                password: '',
                password2: ''
            },
            formState && formState.values ? formState.values : {},
            {
                requestedUsername,
                password: '',
                password2: ''
            }
        ),
        {
            errors: (formState && formState.errors) || {}
        }
    );
});

router.post('/execute-test-signup', async (req, res) => {
    const payload = Object.assign({}, req.body);
    delete payload._csrf;

    try {
        const result = testSignupSchema.validate(payload, {
            abortEarly: false,
            convert: true,
            allowUnknown: false
        });

        const formValues = Object.assign({}, payload, (result && result.value) || {});

        if (result.error) {
            const errors = {};
            result.error.details.forEach(detail => {
                errors[detail.path] = detail.message;
            });

            req.session.testSignupFormState = {
                values: Object.assign({}, formValues, {
                    password: '',
                    password2: ''
                }),
                errors
            };

            return res.redirect(`/test-signup?username=${encodeURIComponent((formValues.requestedUsername || '').trim().toLowerCase())}`);
        }

        const values = result.value;
        const validationError = validateRequestedUsername(values.requestedUsername);

        if (validationError) {
            req.session.testSignupFormState = {
                values: Object.assign({}, values, {
                    password: '',
                    password2: ''
                }),
                errors: {
                    requestedUsername: validationError
                }
            };

            return res.redirect(`/test-signup?username=${encodeURIComponent(values.requestedUsername)}`);
        }

        const usernameAvailable = await isUsernameAvailable(values.requestedUsername, req);

        if (!usernameAvailable) {
            req.session.testSignupFormState = {
                values: Object.assign({}, values, {
                    password: '',
                    password2: ''
                }),
                errors: {
                    requestedUsername: 'That username is no longer available. Please choose another one.'
                }
            };

            return res.redirect(`/test-signup?username=${encodeURIComponent(values.requestedUsername)}`);
        }

        const wildDuckUser = await createWildDuckAccount(req, values);

        adminNotifier
            .notifyFreeSignup({
                emailAddress: `${values.requestedUsername}@${getServiceDomain()}`,
                fullName: values.fullName,
                recoveryEmail: values.recoveryEmail,
                createdAt: new Date()
            })
            .catch(err => {
                console.error('Free signup admin notification error:', err);
            });

        return res.render('test-signup-success', {
            title: 'Test Mailbox Created',
            customerName: values.fullName,
            newEmail: `${values.requestedUsername}@${getServiceDomain()}`,
            recoveryEmail: values.recoveryEmail,
            accountId: wildDuckUser && wildDuckUser.id,
            serviceDomain: getServiceDomain()
        });
    } catch (err) {
        console.error('Test Signup Error:', err);

        req.session.testSignupFormState = {
            values: {
                requestedUsername: (payload.requestedUsername || '').trim().toLowerCase(),
                fullName: payload.fullName || '',
                recoveryEmail: payload.recoveryEmail || '',
                password: '',
                password2: ''
            },
            errors: {
                general: err.message || 'Unable to create the test mailbox right now.'
            }
        };

        return res.redirect(`/test-signup?username=${encodeURIComponent((payload.requestedUsername || '').trim().toLowerCase())}`);
    }
});

router.get('/success', async (req, res) => {
    if (req.query.account) {
        const billingAccount = await billingStore.getAccountByEmail(req.query.account);

        if (!billingAccount) {
            return res.redirect('/');
        }

        if (
            billingAccount.authorizeNet &&
            billingAccount.authorizeNet.customerProfileId &&
            billingAccount.authorizeNet.customerPaymentProfileId &&
            !billingAccount.authorizeNet.subscriptionId
        ) {
            schedulePendingSubscriptionRecovery(billingAccount.emailAddress, 5000);
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
    const handler = async () =>
        res.render('pricing', {
        title: 'Pricing',
        activePurchase: true,
        plans: await listPlans(),
        serviceDomain: getServiceDomain()
    });

    return handler().catch(err => {
        console.error('Pricing Plans Error:', err);
        res.render('pricing', {
            title: 'Pricing',
            activePurchase: true,
            plans: [],
            serviceDomain: getServiceDomain()
        });
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
        return res.json({ available: await isUsernameAvailable(username, req) });
    } catch (err) {
        console.error('WildDuck Check Error:', err);
        res.status(500).json({
            error: 'API Connection Failed'
        });
    }
});



router.get('/purchase-authorize', async (req, res) => {
    const username = (req.query.username || '').trim().toLowerCase();
    const defaultPlan = await getDefaultPlan();
    const resolvedPlan = await getPlan((req.query.plan || '').trim().toLowerCase() || (defaultPlan && defaultPlan.code));
    const plan = (resolvedPlan && resolvedPlan.code) || (defaultPlan && defaultPlan.code) || 'monthly';

    if (!username) {
        return res.redirect(`/purchase?plan=${encodeURIComponent(plan)}`);
    }

    return res.redirect(`/purchase?username=${encodeURIComponent(username)}&plan=${encodeURIComponent(plan)}`);
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
            return redirectCheckout(req, res, formValues, { errors });
        }

        const values = result.value;
        const availablePlans = await listPlans();
        const selectedPlan = availablePlans.find(plan => plan.code === values.selectedPlan);

        if (!selectedPlan) {
            return redirectCheckout(req, res, values, {
                errors: {
                    selectedPlan: 'Please choose one of the active subscription plans.'
                }
            });
        }

        const validationError = validateRequestedUsername(values.requestedUsername);
        if (validationError) {
            return redirectCheckout(req, res, values, {
                errors: {
                    requestedUsername: validationError
                }
            });
        }

        const usernameAvailable = await isUsernameAvailable(values.requestedUsername, req);

        if (!usernameAvailable) {
            return redirectCheckout(req, res, values, {
                errors: {
                    requestedUsername: 'That username is no longer available. Please choose another one.'
                }
            });
        }

        const existingAccount = await billingStore.getAccountByEmail(`${values.requestedUsername}@${getServiceDomain()}`);
        if (existingAccount && existingAccount.status !== 'canceled') {
            return redirectCheckout(req, res, values, {
                errors: {
                    requestedUsername: 'A billing profile already exists for this address.'
                }
            });
        }

        const plan = selectedPlan;
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

        if (!subscription) {
            schedulePendingSubscriptionRecovery(billingAccount.emailAddress, 30000);
            schedulePendingSubscriptionRecovery(billingAccount.emailAddress, 120000);
        }

        await billingStore.recordPayment({
            accountId: billingAccount._id,
            emailAddress: billingAccount.emailAddress,
            username: billingAccount.username,
            transactionId: transaction.transactionId,
            subscriptionId: subscription && subscription.subscriptionId,
            invoiceNumber,
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

            adminNotifier
                .notifyPaidSignup({
                    emailAddress: billingAccount.emailAddress,
                    fullName: billingAccount.fullName,
                    billingEmail: billingAccount.billingEmail,
                    planName: plan.name,
                    amount: plan.price,
                    invoiceNumber,
                    transactionId: transaction.transactionId,
                    createdAt: new Date(),
                    paymentStatus: 'Paid'
                })
                .catch(notificationErr => {
                    console.error('Paid signup admin notification error:', notificationErr);
                });
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
        return redirectCheckout(
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
