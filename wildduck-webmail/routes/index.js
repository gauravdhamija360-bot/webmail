'use strict';

const config = require('wild-config');
const express = require('express');
const fetch = require('node-fetch'); 
const router = new express.Router();

/* GET home page */
router.get('/', (req, res) => {
    res.render('index', {
        isHome: true 
    });
});

/* GET Pricing Page */
router.get('/purchase', (req, res) => {
    res.render('pricing', {
        title: 'Pricing & Plans',
        activePurchase: true // Matches navbar logic if you add this flag
    });
});

/* GET Contact page */
router.get('/contact', (req, res) => {
    res.render('contact', {
        activeContact: true,
        title: 'Contact Us'
    });
});

/* GET Terms of Service */
router.get('/terms', (req, res) => {
    res.render('terms', {
        title: 'Terms of Service'
        // No active flag usually needed for legal footer links
    });
});

/* GET Privacy Policy */
router.get('/privacy', (req, res) => {
    res.render('policy', { // Points to your policy.hbs file
        title: 'Privacy Policy'
    });
});

/* GET Help page */
router.get('/help', (req, res) => {
    res.render('help', {
        activeHelp: true,
        setup: config.setup,
        use2fa: res.locals.user && res.locals.user.enabled2fa && res.locals.user.enabled2fa.length
    });
});

/* POST Contact form handler */
router.post('/contact', (req, res) => {
    const { name, email, subject, message } = req.body;
    
    // Log the submission
    console.log(`Contact Submission: ${name} <${email}> - ${subject}`);

    req.flash('success', 'Your message has been received. We will contact you shortly!');
    res.redirect('/contact');
});

/* API: Username Availability Proxy */
router.get('/api/check-username', async (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const domain = config.serviceDomain || 'yoover.com';
    const email = `${username}@${domain}`;

    try {
        const response = await fetch(`${config.api.url}/user/resolve?address=${encodeURIComponent(email)}`, {
            method: 'GET',
            headers: { 'X-Access-Token': config.api.token }
        });

        if (response.status === 404) {
            return res.json({ available: true });
        }
        
        res.json({ available: false });
    } catch (err) {
        console.error('WildDuck Check Error:', err);
        res.status(500).json({ error: 'API Connection Failed' });
    }
});

module.exports = router;