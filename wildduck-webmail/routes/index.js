'use strict';

const config = require('wild-config');
const express = require('express');
const fetch = require('node-fetch');

const router = new express.Router();

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

module.exports = router;