'use strict';

const express = require('express');
const axios = require('axios');
const router = express.Router();

const DiscordClient = require('../services/discord.js');
const utils = require('../services/utils.js');

const config = require('../config.json');
const redirect = encodeURIComponent(config.discord.redirectUri);

const catchAsyncErrors = fn => ((req, res, next) => {
    const routePromise = fn(req, res, next);
    if (routePromise.catch) {
        routePromise.catch(err => next(err));
    }
});

router.get('/login', (req, res) => {
    const scope = 'guilds%20identify%20email';
    res.redirect(`https://discordapp.com/api/oauth2/authorize?client_id=${config.discord.clientId}&scope=${scope}&response_type=code&redirect_uri=${redirect}`);
});

router.get('/callback', catchAsyncErrors(async (req, res) => {
    if (!req.query.code) {
        throw new Error('NoCodeProvided');
    }
    
    let data = `client_id=${config.discord.clientId}&client_secret=${config.discord.clientSecret}&grant_type=authorization_code&code=${req.query.code}&redirect_uri=${redirect}&scope=guilds%20identify%20email`;
    let headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
    };
    
    axios.post('https://discord.com/api/oauth2/token', data, {
        headers: headers
    }).then(async (response) => {
        const client = new DiscordClient(response.data.access_token);
        client.setAccessToken(response.data.access_token);
        const user = await client.getUser();
        const guilds = await client.getGuilds();
        if (config.discord.userIdWhitelist.length > 0 && config.discord.userIdWhitelist.includes(user.id)) {
            console.log(`Discord user ${user.id} in whitelist, skipping role and guild check...`);
            req.session.logged_in = true;
            req.session.user_id = user.id;
            req.session.username = `${user.username}#${user.discriminator}`;
            req.session.guilds = guilds;
            req.session.roles = await buildGuildRoles(client, user.id, guilds);
            req.session.valid = true;
            req.session.save();
            res.redirect(`/?token=${response.data.access_token}`);
            return;
        }

        req.session.logged_in = true;
        req.session.user_id = user.id;
        req.session.username = `${user.username}#${user.discriminator}`;
        req.session.guilds = guilds;
        req.session.roles = await buildGuildRoles(client, user.id, guilds);
        req.session.valid = utils.hasGuild(guilds);
        req.session.save();
        if (req.session.valid) {
            console.log(user.id, 'Authenticated successfully.');
            if (req.session.current_path) {
                console.log(user.id, 'Redirecting to previous page:', req.session.current_path);
                res.redirect(req.session.current_path);
            } else {
                res.redirect(`/?token=${response.data.access_token}`);
            }
        } else {
            // Not in Discord server(s) and/or have required roles to view map
            console.warn(user.id, 'Not authorized to access map');
            res.redirect('/login');
        }
    }).catch(error => {
        console.error('Error:', error);
        throw new Error('UnableToFetchToken');
    });
}));

const buildGuildRoles = async (client, userId, guilds) => {
    // Return { guild1: [roles], guild2: [roles] }
    let dict = {};
    for (let i = 0; i < guilds.length; i++) {
        let guildId = guilds[i];
        let roles = await client.getUserRoles(guildId, userId);
        dict[guildId] = roles;
    }
    return dict;
};

module.exports = router;
