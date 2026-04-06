'use strict';

const db = require('./db');

const PLANS_COLLECTION = 'billing_plans';

const DEFAULT_PLANS = [
    {
        code: 'monthly',
        name: 'Monthly',
        summary: 'Flexible monthly plan billed once every month.',
        description: 'Ideal when you want to get started quickly with lower commitment.',
        price: 9,
        currency: 'USD',
        intervalLength: 1,
        intervalUnit: 'months',
        featured: false,
        active: true,
        checkoutEnabled: true,
        highlightTag: 'Flexible',
        benefits: ['Professional address on @yoover.com', 'Responsive webmail and mobile setup', 'In-account billing management'],
        sortOrder: 20
    },
    {
        code: 'yearly',
        name: 'Yearly',
        summary: 'Best value annual plan billed once per year.',
        description: 'Lower effective cost for customers who want a long-term identity.',
        price: 39.9,
        currency: 'USD',
        intervalLength: 12,
        intervalUnit: 'months',
        featured: true,
        active: true,
        checkoutEnabled: true,
        highlightTag: 'Best value',
        benefits: ['Lower effective cost than monthly billing', 'Same mailbox experience and account controls', 'Built for long-term personal identity'],
        sortOrder: 10
    }
];

const now = () => new Date();

const getPlans = () => db.collection(PLANS_COLLECTION);

const capitalize = value => String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);

const formatMoney = (amount, currency) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(Number(amount) || 0);

const formatIntervalLabel = plan => {
    const resolved = resolvePlanCadence(plan.intervalLength, plan.intervalUnit);
    const length = resolved.displayLength;

    if (resolved.cadence === 'weeks') {
        return length === 1 ? 'week' : `${length} weeks`;
    }

    if (resolved.cadence === 'months') {
        return length === 1 ? 'month' : `${length} months`;
    }

    if (resolved.cadence === 'years') {
        return length === 1 ? 'year' : `${length} years`;
    }

    return length === 1 ? 'day' : `${length} days`;
};

const normalizeBenefits = benefits =>
    []
        .concat(benefits || [])
        .map(item => String(item || '').trim())
        .filter(Boolean);

const resolvePlanCadence = (intervalLength, intervalUnit) => {
    const length = Math.max(1, Number(intervalLength) || 1);
    const unit = String(intervalUnit || 'months').trim().toLowerCase();

    if (unit === 'weeks' || unit === 'weekly') {
        return { intervalLength: length * 7, intervalUnit: 'days', cadence: 'weeks', displayLength: length };
    }

    if (unit === 'years' || unit === 'yearly' || unit === 'year') {
        return { intervalLength: length * 12, intervalUnit: 'months', cadence: 'years', displayLength: length };
    }

    if (unit === 'months' && length % 12 === 0 && length >= 12) {
        return { intervalLength: length, intervalUnit: 'months', cadence: 'years', displayLength: length / 12 };
    }

    if (unit === 'months' || unit === 'monthly' || unit === 'month') {
        return { intervalLength: length, intervalUnit: 'months', cadence: 'months', displayLength: length };
    }

    if (unit === 'days' && length % 7 === 0 && length >= 7) {
        return { intervalLength: length, intervalUnit: 'days', cadence: 'weeks', displayLength: length / 7 };
    }

    return { intervalLength: length, intervalUnit: 'days', cadence: 'days', displayLength: length };
};

const normalizePlan = plan => {
    const resolvedCadence = resolvePlanCadence(plan.intervalLength, plan.intervalUnit);
    const intervalLength = resolvedCadence.intervalLength;
    const intervalUnit = resolvedCadence.intervalUnit;
    const currency = String(plan.currency || 'USD').trim().toUpperCase() || 'USD';
    const price = Number(plan.price) || 0;
    const benefits = normalizeBenefits(plan.benefits);

    return {
        _id: plan._id,
        code: String(plan.code || '').trim().toLowerCase(),
        name: String(plan.name || '').trim() || capitalize(plan.code || 'Plan'),
        summary: String(plan.summary || '').trim(),
        description: String(plan.description || '').trim(),
        price,
        currency,
        formattedPrice: formatMoney(price, currency),
        intervalLength,
        intervalUnit,
        cadence: resolvedCadence.cadence,
        displayIntervalLength: resolvedCadence.displayLength,
        billingLabel: formatIntervalLabel({ intervalLength, intervalUnit }),
        featured: Boolean(plan.featured),
        active: plan.active !== false,
        checkoutEnabled: plan.checkoutEnabled !== false,
        highlightTag: String(plan.highlightTag || '').trim(),
        benefits,
        sortOrder: Number(plan.sortOrder || 0),
        createdAt: plan.createdAt || null,
        updatedAt: plan.updatedAt || null
    };
};

const getDefaultPlanCode = plans => {
    const activePlans = plans.filter(plan => plan.active && plan.checkoutEnabled);
    const preferred = activePlans.find(plan => plan.featured) || activePlans[0] || plans[0];
    return preferred ? preferred.code : 'monthly';
};

module.exports.init = async () => {
    if (!db.mongo) {
        return;
    }

    await Promise.all([
        getPlans().createIndex({ code: 1 }, { unique: true }),
        getPlans().createIndex({ active: 1, checkoutEnabled: 1, sortOrder: 1 })
    ]);

    const existingCount = await getPlans().countDocuments();
    if (existingCount) {
        return;
    }

    await getPlans().insertMany(
        DEFAULT_PLANS.map(plan =>
            Object.assign({}, plan, {
                createdAt: now(),
                updatedAt: now()
            })
        )
    );
};

module.exports.listPlans = async options => {
    if (!db.mongo) {
        return DEFAULT_PLANS.map(normalizePlan);
    }

    const opts = Object.assign(
        {
            includeInactive: false,
            includeCheckoutDisabled: false
        },
        options || {}
    );
    const filter = {};

    if (!opts.includeInactive) {
        filter.active = true;
    }

    if (!opts.includeCheckoutDisabled) {
        filter.checkoutEnabled = true;
    }

    const plans = await getPlans()
        .find(filter)
        .sort({ sortOrder: 1, price: 1, createdAt: 1 })
        .toArray();

    return plans.map(normalizePlan);
};

module.exports.getPlan = async code => {
    const plans = await module.exports.listPlans({ includeInactive: true, includeCheckoutDisabled: true });
    const normalizedCode = String(code || '').trim().toLowerCase();

    return plans.find(plan => plan.code === normalizedCode) || plans.find(plan => plan.code === 'monthly') || plans[0] || null;
};

module.exports.getCheckoutPlanCodes = async () => {
    const plans = await module.exports.listPlans();
    return plans.map(plan => plan.code);
};

module.exports.getDefaultPlan = async () => {
    const plans = await module.exports.listPlans();
    const code = getDefaultPlanCode(plans);
    return plans.find(plan => plan.code === code) || plans[0] || null;
};
