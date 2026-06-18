const { PrismaClient } = require('@prisma/client');

let client;

function getClient() {
    if (!client) client = new PrismaClient();
    return client;
}

module.exports = new Proxy(
    {},
    {
        get(_target, prop) {
            const value = getClient()[prop];
            return typeof value === 'function' ? value.bind(getClient()) : value;
        },
    },
);
