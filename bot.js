// Load config
const CONFIG = require('./config.json');

// Load packages
var https = require('https');
const fs = require("pn/fs");
const readline = require('readline');
const webshot = require("webshot");
const mysql = require('mysql');
const moment = require('moment');
const momentDurationFormat = require("moment-duration-format");
const Discord = require('discord.js');
const didYouMean = require("didyoumean2");
const ps = require('ps-node');

// Variables
var discordServer = undefined;
var isWorldServerOnline = true;
var worldServerNotificationChannel = undefined;
var itemNames = [];

// Database
var worldDB = mysql.createConnection(CONFIG.worldDB);
worldDB.connect();

function handleDisconnect(conn) {
  conn.on('error', function(err) {
    if (!err.fatal) {
      return;
    }

    if (err.code !== 'PROTOCOL_CONNECTION_LOST') {
      throw err;
    }
    console.log('Re-connecting lost connection: ' + err.stack);
    worldDB = mysql.createConnection(CONFIG.database);
    handleDisconnect(worldDB);
    worldDB.connect();
  });
}

handleDisconnect(worldDB);

// Discord
const client = new Discord.Client();

client.on('unhandledRejection', console.error);

// On Discord ready
client.on('ready', () => {
  discordServer = client.guilds.get(CONFIG.serverId);
  worldServerNotificationChannel = discordServer.channels.get(CONFIG.downtimeNotifier.channelId);

  // Load item names for lookup
  worldDB.query("SELECT name FROM item_template", function(error, results, fields) {
    if (error) throw error;
    if (!!results && results.length > 0)
      itemNames = results.map(x => x.name.toLowerCase());
  });

  downtimeNotifierUpdate();
  setInterval(function() {
    downtimeNotifierUpdate();
  }, CONFIG.downtimeNotifier.checkInterval);
});

// When a new member joins Discord
client.on('guildMemberAdd', member => {
  member.send(CONFIG.welcomeMessage);
});

// Check for commands
client.on('message', message => {
  if (!message || !message.author || !message.guild)
    return;

  if (message.author.bot)
    return;

  const messageGuildMember = discordServer.member(message.author);
  if (!messageGuildMember)
    return;

  if (message.content.toLowerCase() === '.welcome') {
    message.author.send(CONFIG.welcomeMessage);
    return;
  }
});

var downtimeNotifierUpdate = function () {
  var processExists = false;

  ps.lookup({
      command: 'mangosd',
      psargs: 'awwxo pid,comm,args,ppid',
    }, function(err, resultList ) {
      if (err) {
          throw new Error( err );
      }

      resultList.forEach(function( process ){
          if( process ){
            processExists = true;
          }
      });

      if (!processExists && isWorldServerOnline) {
        isWorldServerOnline = false;
        worldServerNotificationChannel.send(CONFIG.downtimeNotifier.downmessage);
      }
      else if (processExists && !isWorldServerOnline) {
        isWorldServerOnline = true;
        worldServerNotificationChannel.send(CONFIG.downtimeNotifier.upmessage);
      }
  });
}

// Start the bot
client.login(CONFIG.token);
