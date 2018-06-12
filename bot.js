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
var itemLinkCooldowns = {};

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

  // Item lookup by ID
	const itemLookupIdRegex = /\[(\d*?)\]/;
	var itemLookupIdMatches = message.content.match(itemLookupIdRegex);
	if (itemLookupIdMatches) {
		if (IsItemLookupOnCooldown(message, message.author.id))
			return;

		var itemId = itemLookupIdMatches[1];

		worldDB.query("SELECT IT.entry, IDI.field5 FROM item_template IT INNER JOIN item_display_info IDI ON IT.displayid = IDI.field0 WHERE IT.entry = ?", [itemId], function (error, results, fields) {
			if (error) throw error;

			if (!!results && results.length > 0)
			{
				var id = results[0].entry;
				var image = results[0].field5;
				sendItemScreenshot(id, image, message);
			}
		});

		return;
	}

	// Item lookup by name
	const itemLookupRegex = /\[(.*?)\]/;
	var itemLookupMatches = message.content.match(itemLookupRegex);
	if (itemLookupMatches) {
		var didYouMeanActive = false;
		var suggestedItem = '';

		if (IsItemLookupOnCooldown(message, message.author.id))
			return;

		var itemName = itemLookupMatches[1];
		if (!itemNames.includes(itemName.toLowerCase()))
		{
			suggestedItem = didYouMean(itemName, itemNames);
			if (!!suggestedItem)
				didYouMeanActive = true;
		}

		worldDB.query("SELECT IT.entry, IT.name, IDI.field5 FROM item_template IT INNER JOIN item_display_info IDI ON IT.displayid = IDI.field0 WHERE IT.name = ?", [didYouMeanActive ? suggestedItem : itemName], function (error, results, fields) {
			if (error) throw error;

			if (!!results && results.length > 0)
			{
				var id = results[0].entry;
				var image = results[0].field5;
				var name = results[0].name;
				sendItemScreenshot(id, image, message, itemName, didYouMeanActive ? name : '');
			}
		});

		return;
	}

	// Item lookup by URL
	const itemLookupUrlRegex = /db\.classicdb\.ch\/\?item=(.\d*)/;
	var itemLookupUrlMatches = message.content.match(itemLookupUrlRegex);
	if (itemLookupUrlMatches) {
		if (IsItemLookupOnCooldown(message, message.author.id))
			return;

		var itemId = itemLookupUrlMatches[1];

		var itemId = itemLookupUrlMatches[1];
		worldDB.query("SELECT IT.entry, IDI.field5 FROM item_template IT INNER JOIN item_display_info IDI ON IT.displayid = IDI.field0 WHERE IT.entry = ?", [itemId], function (error, results, fields) {
			if (error) throw error;

			if (!!results && results.length > 0)
			{
				var id = results[0].entry;
				var image = results[0].field5;
				sendItemScreenshot(id, image, message);
			}
		});

		return;
	}
});

var sendItemScreenshot = function (id, image, message, itemName, suggestedItem) {
	var filenamePng = "./items/png/" + id + ".png";
	var filenameHtml = "./items/html/" + id + ".html";
	var url = CONFIG.siteUrl + "tooltip/1/" + id + '/html';
	var itemTooltipUrl = CONFIG.siteUrl + "tooltip/1/" + id;
	var itemTemplateUrl = "./item-tooltip.html";
	var itemUrl = CONFIG.siteUrl + "item/1/" + id;
	var vdbUrl = "http://classicdb.ch/?item=" + id;

	if (fs.existsSync(filenamePng)) {
	    message.channel.send(
			!!suggestedItem ? "I couldn't find [" + itemName + "], did you mean [" + suggestedItem + "]?" : "here's your item!\n" +
			"**" + CONFIG.siteName + " DB:** " + itemUrl + "\n" +
			"**Classic DB:** " + vdbUrl, { reply: message.author, files: [filenamePng]});
		return;
	}

	webshot(url, filenamePng, { captureSelector: '.item_space', renderDelay: 1000 }, function (err) {
		if (!!err) console.log(err);

	    message.channel.send(
			!!suggestedItem ? "I couldn't find [" + itemName + "], did you mean [" + suggestedItem + "]?" : "here's your item!\n" +
			"**" + CONFIG.siteName + " DB:** " + itemUrl + "\n" +
			"**Classic DB:** " + vdbUrl, { reply: message.author, files: [filenamePng]});
	});
}

var IsItemLookupOnCooldown = function (message, userId) {
	var now = new Date();
	var nowMS = now.getTime();

	if (!!itemLinkCooldowns[userId] && (nowMS - itemLinkCooldowns[userId] < CONFIG.itemLinkCooldownMS))
	{
		var randomMessage = config.cooldownWarnings[Math.floor(Math.random() * config.cooldownWarnings.length)];
		message.channel.send("**" + randomMessage + "** Item lookups have a 5 second cooldown. Please wait a few seconds before looking up another item.", { reply: message.author });
		return true;
	}

	itemLinkCooldowns[userId] = nowMS;
	return false;
}

var download = function(url, dest, cb) {
	var file = fs.createWriteStream(dest);
	var request = https.get(url, function(response) {
		response.pipe(file);
		file.on('finish', function() {
			file.close(cb);  // close() is async, call cb after close completes.
		});
	}).on('error', function(err) { // Handle errors
		fs.unlink(dest); // Delete the file async. (But we don't check the result)
		if (cb) cb(err.message);
	});
};

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
