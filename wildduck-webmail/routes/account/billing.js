'use strict';

const express = require('express');
const router = new express.Router();
const Joi = require('joi');
const config = require('wild-config');
const passport = require('../../lib/passport');
const billingStore = require('../../lib/billing-store');
const authorizeNet = require('../../lib/authorize-net');
const { getPlan } = require('../../lib/billing-plans');

const getServiceDomain = () => (config.service && config.service.domain) || config.serviceDomain || 'yoover.com';

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

const paymentMethodSchema = Joi.object({
    fullName: Joi.string().trim().min(2).max(120).required(),
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

const splitName = fullName => {
    const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
    return {
        firstName: parts.shift() || '',
        lastName: parts.join(' ') || '.'
    };
};

const addBillingCycle = (date, plan) => {
    if (!date || !plan) {
        return null;
    }

    const nextDate = new Date(date);
    if (Number.isNaN(nextDate.getTime())) {
        return null;
    }

    nextDate.setUTCMonth(nextDate.getUTCMonth() + plan.intervalLength);
    return nextDate;
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
                country: (billTo && billTo.getCountry && billTo.getCountry()) || ''
            }
        };
    });
};

const getDerivedNextBillingAt = billingAccount => {
    if (!billingAccount || !billingAccount.plan) {
        return null;
    }

    if (billingAccount.subscription && billingAccount.subscription.nextBillingAt) {
        return billingAccount.subscription.nextBillingAt;
    }

    const startedAt = billingAccount.subscription && billingAccount.subscription.startedAt;
    return addBillingCycle(startedAt, billingAccount.plan);
};

const getAuthorizeSubscriptionName = billingAccount => {
    if (!billingAccount || !billingAccount.plan) {
        return '';
    }

    return `${billingAccount.username}@${getServiceDomain()} ${billingAccount.plan.name}`.slice(0, 50);
};

const renderBilling = async (req, res, billingAccount, options) => {
    const payments = billingAccount ? await billingStore.listPayments(billingAccount._id) : [];
    const derivedNextBillingAt = getDerivedNextBillingAt(billingAccount);
    const subscriptionStatus = billingAccount && billingAccount.subscription && billingAccount.subscription.status;
    const subscriptionActive = subscriptionStatus === 'active';
    const subscriptionPending = subscriptionStatus === 'pending_activation' || (!subscriptionStatus && billingAccount && billingAccount.status === 'payment-captured');

    const viewBillingAccount = billingAccount
        ? Object.assign({}, billingAccount, {
              subscription: billingAccount.subscription
                  ? Object.assign({}, billingAccount.subscription, {
                        nextBillingAt: formatDate(billingAccount.subscription.nextBillingAt || derivedNextBillingAt),
                        currentPeriodEndsAt: formatDate(billingAccount.subscription.currentPeriodEndsAt),
                        startedAt: formatDate(billingAccount.subscription.startedAt),
                        canceledAt: formatDate(billingAccount.subscription.canceledAt)
                    })
                  : null
          })
        : null;

    return res.render('account/billing', {
        title: 'Billing',
        activeHome: true,
        accMenuBilling: true,
        billingAccount: viewBillingAccount,
        subscriptionActive,
        subscriptionPending,
        canSyncSubscription:
            Boolean(
                billingAccount &&
                    billingAccount.authorizeNet &&
                    billingAccount.authorizeNet.customerProfileId &&
                    billingAccount.authorizeNet.customerPaymentProfileId &&
                    (!billingAccount.authorizeNet.subscriptionId || subscriptionPending)
            ),
        subscriptionSetupNote: billingAccount && billingAccount.meta && billingAccount.meta.subscriptionSetupNote,
        payments: payments.map(payment =>
            Object.assign({}, payment, {
                createdAt: formatDate(payment.createdAt)
            })
        ),
        addMethodErrors: (options && options.addMethodErrors) || {},
        addMethodValues: (options && options.addMethodValues) || {
            fullName: billingAccount && billingAccount.fullName,
            company: '',
            addressLine1: '',
            addressLine2: '',
            city: '',
            state: '',
            zip: '',
            country: 'US'
        },
        authorizeApiLoginID: process.env.AUTHORIZE_API_LOGIN_ID,
        authorizeClientKey: process.env.AUTHORIZE_CLIENT_KEY,
        csrfToken: req.csrfToken()
    });
};

router.get('/', passport.checkLogin, async (req, res) => {
    let billingAccount = await billingStore.getAccountForUser(req.user);

    if (billingAccount && billingAccount.authorizeNet && billingAccount.authorizeNet.customerProfileId) {
        try {
            const gatewayProfile = await authorizeNet.getCustomerProfile(billingAccount.authorizeNet.customerProfileId);
            const paymentMethods = normalizeMaskedPaymentProfiles(gatewayProfile);
            let subscriptionStatus = billingAccount.subscription && billingAccount.subscription.status;
            let authorizeState = Object.assign({}, billingAccount.authorizeNet);
            let subscriptionState = Object.assign({}, billingAccount.subscription || {});

            if (!authorizeState.subscriptionId && billingAccount.plan) {
                const recoveredSubscription = await authorizeNet.findSubscriptionByCustomerProfile({
                    customerProfileId: authorizeState.customerProfileId,
                    customerPaymentProfileId: authorizeState.customerPaymentProfileId,
                    expectedAmount: billingAccount.plan.price,
                    expectedName: getAuthorizeSubscriptionName(billingAccount)
                });

                if (recoveredSubscription && recoveredSubscription.subscriptionId) {
                    const nextBillingAt = getDerivedNextBillingAt(billingAccount);
                    authorizeState.subscriptionId = recoveredSubscription.subscriptionId;
                    subscriptionStatus = recoveredSubscription.status || subscriptionStatus;
                    subscriptionState = Object.assign({}, subscriptionState, {
                        id: recoveredSubscription.subscriptionId,
                        status: subscriptionStatus,
                        nextBillingAt: subscriptionState.nextBillingAt || nextBillingAt,
                        currentPeriodEndsAt: subscriptionState.currentPeriodEndsAt || nextBillingAt
                    });
                }
            }

            if (authorizeState.subscriptionId) {
                subscriptionStatus = await authorizeNet.getSubscriptionStatus(authorizeState.subscriptionId);
                subscriptionState = Object.assign({}, subscriptionState, {
                    status: subscriptionStatus
                });
            }

            billingAccount = await billingStore.setSubscriptionStatus(billingAccount._id, subscriptionStatus, {
                authorizeNet: authorizeState,
                subscription: subscriptionState,
                paymentMethods
            });
        } catch (err) {
            req.flash('warning', `Billing sync warning: ${err.message}`);
        }
    }

    return renderBilling(req, res, billingAccount, {});
});

router.post('/sync', passport.checkLogin, async (req, res) => {
    let billingAccount = await billingStore.getAccountForUser(req.user);

    if (!billingAccount || !billingAccount.authorizeNet || !billingAccount.authorizeNet.customerProfileId) {
        req.flash('danger', 'Billing profile not found.');
        return res.redirect('/account/billing');
    }

    try {
        const gatewayProfile = await authorizeNet.getCustomerProfile(billingAccount.authorizeNet.customerProfileId);
        const paymentMethods = normalizeMaskedPaymentProfiles(gatewayProfile);

        let authorizeState = Object.assign({}, billingAccount.authorizeNet);
        let subscriptionState = Object.assign({}, billingAccount.subscription || {});
        let status = billingAccount.status;
        let note = '';

        if (!billingAccount.authorizeNet.subscriptionId) {
            const plan = getPlan(billingAccount.plan && billingAccount.plan.code);
            const baseDate = subscriptionState.startedAt || billingAccount.createdAt || new Date();
            const nextBillingAt = addBillingCycle(baseDate, plan);
            const recoveredSubscription = await authorizeNet.findSubscriptionByCustomerProfile({
                customerProfileId: billingAccount.authorizeNet.customerProfileId,
                customerPaymentProfileId: billingAccount.authorizeNet.customerPaymentProfileId,
                expectedAmount: plan.price,
                expectedName: getAuthorizeSubscriptionName(billingAccount)
            });

            if (recoveredSubscription && recoveredSubscription.subscriptionId) {
                authorizeState.subscriptionId = recoveredSubscription.subscriptionId;
                subscriptionState = Object.assign({}, subscriptionState, {
                    id: recoveredSubscription.subscriptionId,
                    status: recoveredSubscription.status || 'active',
                    startedAt: subscriptionState.startedAt || billingAccount.createdAt || new Date(),
                    nextBillingAt,
                    currentPeriodEndsAt: nextBillingAt,
                    canceledAt: recoveredSubscription.status === 'canceled' ? subscriptionState.canceledAt || new Date() : null
                });
                note = `Recovered existing Authorize.Net subscription ${recoveredSubscription.subscriptionId}.`;
                status =
                    recoveredSubscription.status === 'active' && billingAccount.wildduckUserId
                        ? 'active'
                        : billingAccount.status;
            } else {
                const subscription = await authorizeNet.createSubscription({
                    name: getAuthorizeSubscriptionName(billingAccount),
                    amount: plan.price,
                    customerProfileId: billingAccount.authorizeNet.customerProfileId,
                    customerPaymentProfileId: billingAccount.authorizeNet.customerPaymentProfileId,
                    intervalLength: plan.intervalLength,
                    intervalUnit: plan.intervalUnit,
                    startDate: nextBillingAt.toISOString().slice(0, 10),
                    totalOccurrences: 9999
                });

                authorizeState.subscriptionId = subscription.subscriptionId;
                subscriptionState = Object.assign({}, subscriptionState, {
                    id: subscription.subscriptionId,
                    status: 'active',
                    startedAt: subscriptionState.startedAt || billingAccount.createdAt || new Date(),
                    nextBillingAt,
                    currentPeriodEndsAt: nextBillingAt,
                    canceledAt: null
                });
                status = billingAccount.wildduckUserId ? 'active' : billingAccount.status;
            }
        } else {
            const subscriptionStatus = await authorizeNet.getSubscriptionStatus(billingAccount.authorizeNet.subscriptionId);
            subscriptionState = Object.assign({}, subscriptionState, {
                status: subscriptionStatus
            });
            if (subscriptionStatus === 'active' && !subscriptionState.nextBillingAt) {
                subscriptionState.nextBillingAt = getDerivedNextBillingAt(billingAccount);
                subscriptionState.currentPeriodEndsAt = subscriptionState.currentPeriodEndsAt || subscriptionState.nextBillingAt;
            }
            status = subscriptionStatus === 'active' && billingAccount.wildduckUserId ? 'active' : billingAccount.status;
        }

        billingAccount = await billingStore.upsertAccount(
            Object.assign({}, billingAccount, {
                status,
                authorizeNet: authorizeState,
                paymentMethods,
                subscription: subscriptionState,
                meta: Object.assign({}, billingAccount.meta, {
                    subscriptionSetupNote: note
                })
            })
        );

        req.flash('success', 'Billing details synced with Authorize.Net.');
    } catch (err) {
        req.flash('warning', err.message || 'Unable to sync billing right now.');
    }

    return res.redirect('/account/billing');
});

router.post('/cancel', passport.checkLogin, async (req, res) => {
    const billingAccount = await billingStore.getAccountForUser(req.user);

    if (!billingAccount || !billingAccount.authorizeNet || !billingAccount.authorizeNet.subscriptionId) {
        req.flash('warning', 'No active subscription was found.');
        return res.redirect('/account/billing');
    }

    try {
        await authorizeNet.cancelSubscription(billingAccount.authorizeNet.subscriptionId);
        await billingStore.setSubscriptionStatus(billingAccount._id, 'canceled', {
            authorizeNet: billingAccount.authorizeNet,
            subscription: Object.assign({}, billingAccount.subscription, {
                status: 'canceled',
                canceledAt: new Date(),
                nextBillingAt: null
            }),
            paymentMethods: billingAccount.paymentMethods
        });
        req.flash('success', 'Your subscription has been canceled.');
    } catch (err) {
        req.flash('danger', err.message || 'Unable to cancel subscription.');
    }

    return res.redirect('/account/billing');
});

router.post('/payment-methods', passport.checkLogin, async (req, res) => {
    const billingAccount = await billingStore.getAccountForUser(req.user);

    if (!billingAccount || !billingAccount.authorizeNet || !billingAccount.authorizeNet.customerProfileId) {
        req.flash('danger', 'Billing profile not found.');
        return res.redirect('/account/billing');
    }

    const payload = Object.assign({}, req.body);
    delete payload._csrf;

    const result = paymentMethodSchema.validate(payload, {
        abortEarly: false,
        convert: true,
        allowUnknown: false
    });

    if (result.error) {
        const errors = {};
        result.error.details.forEach(detail => {
            errors[detail.path] = detail.message;
        });
        return renderBilling(req, res, billingAccount, {
            addMethodErrors: errors,
            addMethodValues: payload
        });
    }

    try {
        const values = result.value;
        const name = splitName(values.fullName);
        await authorizeNet.createCustomerPaymentProfile({
            customerProfileId: billingAccount.authorizeNet.customerProfileId,
            opaqueData: {
                dataDescriptor: values.dataDescriptor,
                dataValue: values.dataValue
            },
            billTo: {
                firstName: name.firstName,
                lastName: name.lastName,
                company: values.company,
                address: values.addressLine1,
                city: values.city,
                state: values.state,
                zip: values.zip,
                country: values.country
            },
            setAsDefault: !billingAccount.paymentMethods || !billingAccount.paymentMethods.length
        });

        const gatewayProfile = await authorizeNet.getCustomerProfile(billingAccount.authorizeNet.customerProfileId);
        const paymentMethods = normalizeMaskedPaymentProfiles(gatewayProfile);

        await billingStore.setSubscriptionStatus(billingAccount._id, billingAccount.status, {
            authorizeNet: billingAccount.authorizeNet,
            subscription: billingAccount.subscription,
            paymentMethods
        });

        req.flash('success', 'Payment method added successfully.');
        return res.redirect('/account/billing');
    } catch (err) {
        return renderBilling(req, res, billingAccount, {
            addMethodErrors: {
                general: err.message || 'Unable to add payment method.'
            },
            addMethodValues: payload
        });
    }
});

router.post('/payment-methods/:paymentProfileId/default', passport.checkLogin, async (req, res) => {
    const billingAccount = await billingStore.getAccountForUser(req.user);

    if (!billingAccount || !billingAccount.authorizeNet || !billingAccount.authorizeNet.subscriptionId) {
        req.flash('danger', 'Subscription record not found.');
        return res.redirect('/account/billing');
    }

    try {
        await authorizeNet.updateSubscriptionPaymentProfile({
            subscriptionId: billingAccount.authorizeNet.subscriptionId,
            customerProfileId: billingAccount.authorizeNet.customerProfileId,
            customerPaymentProfileId: req.params.paymentProfileId
        });

        const paymentMethods = [].concat(billingAccount.paymentMethods || []).map(method =>
            Object.assign({}, method, {
                defaultPaymentProfile: method.customerPaymentProfileId === req.params.paymentProfileId
            })
        );

        const authorizeState = Object.assign({}, billingAccount.authorizeNet, {
            customerPaymentProfileId: req.params.paymentProfileId
        });

        await billingStore.setSubscriptionStatus(billingAccount._id, billingAccount.status, {
            authorizeNet: authorizeState,
            subscription: Object.assign({}, billingAccount.subscription),
            paymentMethods
        });

        req.flash('success', 'Default payment method updated.');
    } catch (err) {
        req.flash('danger', err.message || 'Unable to update the payment method.');
    }

    return res.redirect('/account/billing');
});

router.post('/payment-methods/:paymentProfileId/delete', passport.checkLogin, async (req, res) => {
    const billingAccount = await billingStore.getAccountForUser(req.user);

    if (!billingAccount || !billingAccount.authorizeNet || !billingAccount.authorizeNet.customerProfileId) {
        req.flash('danger', 'Billing profile not found.');
        return res.redirect('/account/billing');
    }

    if (
        billingAccount.authorizeNet.customerPaymentProfileId === req.params.paymentProfileId &&
        billingAccount.subscription &&
        billingAccount.subscription.status === 'active'
    ) {
        req.flash('warning', 'Set another payment method as default before deleting the active one.');
        return res.redirect('/account/billing');
    }

    try {
        await authorizeNet.deleteCustomerPaymentProfile({
            customerProfileId: billingAccount.authorizeNet.customerProfileId,
            customerPaymentProfileId: req.params.paymentProfileId
        });

        const paymentMethods = [].concat(billingAccount.paymentMethods || []).filter(
            method => method.customerPaymentProfileId !== req.params.paymentProfileId
        );

        await billingStore.setSubscriptionStatus(billingAccount._id, billingAccount.status, {
            authorizeNet: billingAccount.authorizeNet,
            subscription: billingAccount.subscription,
            paymentMethods
        });

        req.flash('success', 'Payment method removed.');
    } catch (err) {
        req.flash('danger', err.message || 'Unable to remove payment method.');
    }

    return res.redirect('/account/billing');
});

module.exports = router;
