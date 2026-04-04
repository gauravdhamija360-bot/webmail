'use strict';

const PLANS = {
    monthly: {
        code: 'monthly',
        name: 'Monthly',
        price: 9.0,
        formattedPrice: '$9.00',
        intervalLength: 1,
        intervalUnit: 'months',
        summary: 'Flexible monthly plan billed every 30 days.'
    },
    yearly: {
        code: 'yearly',
        name: 'Yearly',
        price: 39.9,
        formattedPrice: '$39.90',
        intervalLength: 12,
        intervalUnit: 'months',
        summary: 'Best value annual plan billed once per year.'
    }
};

module.exports = {
    PLANS,
    getPlan(code) {
        return PLANS[code] || PLANS.monthly;
    },
    listPlans() {
        return Object.keys(PLANS).map(key => PLANS[key]);
    }
};
