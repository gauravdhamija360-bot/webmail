'use strict';

const express = require('express');
const router = new express.Router();
const config = require('wild-config');
const fetch = require('node-fetch');

// --- UPDATE THESE TWO LINES ---
const authorizenet = require('authorizenet');
const SDK = authorizenet.APIContracts;
const SDKController = authorizenet.APIControllers;
// ------------------------------
/* ------------------------------
   SAFE STRIPE INITIALIZATION
--------------------------------*/

let stripe = null;

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
        serviceDomain: config.serviceDomain || 'yoover.com'
    });
});

// Purchase Page
router.get('/purchase', (req, res) => {

    const requestedUsername = req.query.username;

    if (!requestedUsername) {
        return res.redirect('/');
    }

    res.render('purchase', {
        title: 'Complete Your Registration',
        activePurchase: true,
        requestedUsername,
        serviceDomain: config.serviceDomain || 'yoover.com'
    });

});

// Stripe Purchase Page
router.get('/purchase-email-subscription', (req, res) => {

    res.render('stripe-test', {
        title: 'Stripe Purchase',
        activePurchase: true,
        testUsername: 'tester' + Math.floor(Math.random() * 100),
        serviceDomain: config.serviceDomain || 'yoover.com',
        stripePublicKey: process.env.STRIPE_PUBLISHABLE_KEY,
        csrfToken: req.csrfToken()
    });

});

/* --- SUCCESS PAGE --- */

router.get('/success', async (req, res) => {

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
            newEmail: `${session.metadata.username}@${config.serviceDomain}`,
            serviceDomain: config.serviceDomain || 'yoover.com'
        });

    } catch (err) {

        console.error('Stripe Retrieve Error:', err);
        res.redirect('/');

    }

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
                        name: `Professional Email: ${requestedUsername}@${config.serviceDomain}`,
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
        serviceDomain: config.serviceDomain || 'yoover.com'
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
        serviceDomain: config.serviceDomain || 'yoover.com'
    });

});

router.get('/terms', (req, res) => {

    res.render('terms', {
        title: 'Terms of Service',
        serviceDomain: config.serviceDomain || 'yoover.com'
    });

});

router.get('/privacy', (req, res) => {

    res.render('policy', {
        title: 'Privacy Policy',
        serviceDomain: config.serviceDomain || 'yoover.com'
    });

});

router.get('/help', (req, res) => {

    res.render('help', {
        title: 'Help',
        activeHelp: true,
        setup: config.setup,
        serviceDomain: config.serviceDomain || 'yoover.com',
        use2fa:
            res.locals.user &&
            res.locals.user.enabled2fa &&
            res.locals.user.enabled2fa.length
    });

});

/* --- 4. API PROXIES --- */

router.get('/api/check-username', async (req, res) => {

    const { username } = req.query;

    if (!username) {
        return res.status(400).json({
            error: 'Username is required'
        });
    }

    const domain = config.serviceDomain || 'yoover.com';
    const email = `${username}@${domain}`;

    try {

        const response = await fetch(
            `${config.api.url}/user/resolve?address=${encodeURIComponent(email)}`,
            {
                method: 'GET',
                headers: {
                    'X-Access-Token': config.api.token
                }
            }
        );

        if (response.status === 404) {
            return res.json({ available: true });
        }

        res.json({ available: false });

    } catch (err) {

        console.error('WildDuck Check Error:', err);

        res.status(500).json({
            error: 'API Connection Failed'
        });

    }

});



// Authorize.net Purchase Page
router.get('/purchase-authorize', (req, res) => {
    res.render('authorize-signup', {
        authorizeApiLoginID: process.env.AUTHORIZE_API_LOGIN_ID, // Use the correct Login ID
        authorizeClientKey: process.env.AUTHORIZE_CLIENT_KEY,
        requestedUsername: req.query.username || 'tester',
        csrfToken: req.csrfToken(),
        serviceDomain: config.serviceDomain
    });
});



router.post('/execute-authorize-payment', async (req, res) => {
    const { dataDescriptor, dataValue, requestedUsername, fullName, recoveryEmail } = req.body;

    try {
        // 1. Setup Authorize.net Authentication
        const merchantAuthenticationType = new SDK.MerchantAuthenticationType();
        merchantAuthenticationType.setName(process.env.AUTHORIZE_API_LOGIN_ID);
        merchantAuthenticationType.setTransactionKey(process.env.AUTHORIZE_TRANSACTION_KEY);

        const opaqueData = new SDK.OpaqueDataType();
        opaqueData.setDataDescriptor(dataDescriptor);
        opaqueData.setDataValue(dataValue);

        const paymentType = new SDK.PaymentType();
        paymentType.setOpaqueData(opaqueData);

        const transactionRequestType = new SDK.TransactionRequestType();
        transactionRequestType.setTransactionType(SDK.TransactionTypeEnum.AUTHCAPTURETRANSACTION);
        transactionRequestType.setPayment(paymentType);
        transactionRequestType.setAmount(15.00); 

        const createRequest = new SDK.CreateTransactionRequest();
        createRequest.setMerchantAuthentication(merchantAuthenticationType);
        createRequest.setTransactionRequest(transactionRequestType);

        const ctrl = new SDKController.CreateTransactionController(createRequest.getJSON());
        
        // Ensure this matches your testing environment
        ctrl.setEnvironment('https://apitest.authorize.net/xml/v1/request.api');

        ctrl.execute(async () => {
            const apiResponse = ctrl.getResponse();
            
            if (!apiResponse) {
                return res.status(500).send('No response from payment gateway.');
            }

            const response = new SDK.CreateTransactionResponse(apiResponse);
            const resultMsg = response.getMessages();

            // Safety check for message object
            if (resultMsg && resultMsg.getResultCode() === SDK.MessageTypeEnum.OK) {
                const tResponse = response.getTransactionResponse();
                
                // ResponseCode '1' is the ONLY "Success" code in Authorize.net
                if (tResponse && tResponse.getResponseCode() === '1') {
                    
                    try {
                        // --- WILDDUCK ACCOUNT CREATION ---
                        const wdResponse = await fetch(`${config.api.url}/user`, {
                            method: 'POST',
                            headers: {
                                'X-Access-Token': config.api.token,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                username: requestedUsername,
                                name: fullName,
                                recoveryEmail: recoveryEmail,
                                password: 'ChangeMe123!', 
                                address: `${requestedUsername}@${config.serviceDomain}`
                            })
                        });

                        if (wdResponse.ok) {
                            return res.redirect(`/success?gateway=authorize&user=${encodeURIComponent(requestedUsername)}`);
                        } else {
                            const errorData = await wdResponse.json();
                            console.error('WildDuck Creation Error:', errorData);
                            return res.status(500).send('Payment successful, but mailbox creation failed.');
                        }
                    } catch (err) {
                        console.error('WildDuck API Connection Error:', err);
                        return res.status(500).send('Account creation timed out.');
                    }

                } else {
                    // Handle Card Declines (e.g., Code 2 or 3)
                    const errorText = tResponse.getErrors() ? tResponse.getErrors().getError()[0].getErrorText() : 'Transaction Declined';
                    return res.status(400).send(`Payment Declined: ${errorText}`);
                }
            } else {
                // Communication Error (Invalid Keys / Expired Token)
                const errText = resultMsg ? resultMsg.getMessage()[0].getText() : 'Unknown Gateway Error';
                console.error('Authorize.net Error:', errText);
                return res.status(500).send(`Payment Failed: ${errText}`);
            }
        });
    } catch (globalErr) {
        console.error('Authorize.net SDK Crash:', globalErr);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;