var phantom = require('phantom');
var jQuery = require('jquery-deferred');
var winston = require('winston');
var util = require('util');

winston.loggers.add('log',{
    console: {
        level: 'info',
        timestamp: true,
        json: false,
        prettyPrint: true,
        colorize: true
    },
    file: {
        level: 'info',
        filename: 'monitor.log',
        tailable: true,
        prettyPrint: true,
        json: false,
        colorize: false,
        timestamp: true
    }
});
var log = winston.loggers.get('log');
var cfg = {};
refreshConfig();


log.debug ('[Main] ', cfg);
log.info ('[Main] Starting UrlMonitor Process');
start();

function start() {
    try {
        refreshConfig();
        var dfd = new jQuery.Deferred();
        dfd.done(function (urls) {
            petFinder_ProcessDetailsPage(urls);
        });

        petFinder_ProcessMainPage(dfd, cfg.petfinder.url.mainPage);
    } catch (err) {
        log.error('[Main] %s', err.stack);
    }
}


function petFinder_ProcessMainPage(dfd, url) {
    phantom.create(function (ph) {
        log.debug('[Browser] Creating page for url: %s', url);
        ph.createPage(function (page) {
            log.debug('[Browser] Opening url: %s', url);
            page.open(url,
                function () {
                    log.debug('[Browser] Starting scraping page at %s', url);
                    page.evaluate(
                        function (cfg) {
                            var ret = [];
                            var elements = document.querySelectorAll(cfg.petfinder.selector.hits);
                            Array.prototype.forEach.call(elements, function (el) {
                                ret.push(el.href);
                            });
                            return ret;
                        },
                        function (result) {
                            log.debug('[Browser] Finished scraping page at %s', url);
                            ph.exit();
                            dfd.resolve(result);
                        },
                        cfg
                    );
                }
            );
        });
    });
}

function petFinder_ProcessDetailsPage(urls) {
     urls.forEach(function (url) {
        phantom.create(function (ph) {
        log.debug('[Browser] Creating page for url: %s', url);
            ph.createPage(function (page) {
                log.debug('[Browser] Opening url: %s', url);
                page.open(url,
                    function () {
                        log.debug('[Browser] Starting scraping page at %s', url);
                        page.evaluate(
                            function (cfg) {
                                var images = [];
                                var imgNodes = document.querySelectorAll(cfg.petfinder.selector.images);
                                Array.prototype.forEach.call(imgNodes, function (el) {
                                    images.push(el.src);
                                });
                                var ret = {};
                                ret.images = images;

                                try { ret.name = document.querySelector(cfg.petfinder.selector.name).innerHTML; } catch (ignore) {}
                                try { ret.summary = document.querySelector(cfg.petfinder.selector.summary).innerHTML; } catch (ignore) {}
                                try { ret.contact_name = document.querySelector(cfg.petfinder.selector.contact_name).innerHTML; } catch (ignore) {}
                                try { ret.contact_phone = document.querySelector(cfg.petfinder.selector.contact_phone).innerHTML; } catch (ignore) {}
                                try { ret.contact_text = document.querySelector(cfg.petfinder.selector.contact_text).innerHTML; } catch (ignore) {}
                                try { ret.contact_url = document.querySelector(cfg.petfinder.selector.contact_url).innerHTML; } catch (ignore) {}
                                try { ret.contact_city = document.querySelector(cfg.petfinder.selector.contact_city).innerHTML; } catch (ignore) {}
                                try { ret.contact_state = document.querySelector(cfg.petfinder.selector.contact_state).innerHTML; } catch (ignore) {}
                                try { ret.about = document.querySelector(cfg.petfinder.selector.about).innerHTML; } catch (ignore) {}
                                try { ret.details = document.querySelector(cfg.petfinder.selector.details).innerHTML; } catch (ignore) {}
                                return ret;
                            },
                            function (result) {
                                log.debug('[Browser] Finished scraping page at %s', url);
                                ph.exit();
                                var idMatcher = /petdetail\/([\w-]{8})/;
                                result.creation = getDateTime();
                                result.id = url.match(idMatcher)[1];
                                result.url = url;
                                if (persistData(result)) {
                                    sendEmail(result)
                                }
                            },
                            cfg
                        );
                    }
                );
            });
        });
    });
    setTimeout(function() {
        start();
    }, cfg.pollingInterval);
}

function buildHtmlMessage(data) {
    log.debug('[Mail] Starting building mail body');
    var builder = require('xmlbuilder');

    var root = builder.create('div', { 'id': 'adBox'});

    var imagesBox = root.ele('span', {'id': 'imagesBox'});
    var ctr = 1;
    data.images.forEach(function (imageUrl) {
        var imageElement = imagesBox.ele('img');
        imageElement.att('id', "img" + ctr);
        imageElement.att('src', imageUrl);
    });

    var detailsBox = root.ele('div', {'id': 'detailsBox'});
    detailsBox.ele('div', {'id': 'title'}, data.name);
    if (data.summary) { detailsBox.ele('br'); detailsBox.ele('br'); detailsBox.ele('div', {'id': 'summary'}, data.summary); }
    detailsBox.ele('br'); detailsBox.ele('br');
    if (data.contact_name) { detailsBox.ele('div', {'id': 'contact_name'}, 'Contact: ' + data.contact_name); }
    if (data.contact_phone) { detailsBox.ele('div', {'id': 'contact_phone'}, 'Contact: ' + data.contact_phone); }
    if (data.contact_text) { detailsBox.ele('div', {'id': 'contact_text'}, 'Contact: ' + data.contact_text); }
    if (data.contact_url) { detailsBox.ele('div', {'id': 'contact_url'}, 'Contact: ' + data.contact_url); }
    if (data.contact_city) { detailsBox.ele('div', {'id': 'contact_city'}, 'City: ' + data.contact_city); }
    if (data.contact_state) { detailsBox.ele('div', {'id': 'contact_state'}, 'State: ' + data.contact_state); }
    if (data.creation) { detailsBox.ele('div', {'id': 'creation'}, 'Creation Timestamp: ' + data.creation); }
    if (data.about) { detailsBox.ele('br'); detailsBox.ele('br'); detailsBox.ele('div', {'id': 'about'}, 'About: ' + data.about); }
    if (data.details) { detailsBox.ele('br'); detailsBox.ele('br'); detailsBox.ele('div', {'id': 'details'}, 'Details: ' + data.details); }

    root.end({ pretty: true });
    log.debug('[Mail] Finished building mail body');
    return root;
}

function persistData(data) {
    try {
        log.debug('[DB] Writing data to database');
        var locallydb = require('locallydb');
        var db = new locallydb('./data'); // load the database (folder) in './data', will be created if doesn't exist
        var collection = db.collection('monitor'); // load the collection (file) in './data', will be created if doesn't exist
        var id = data.id;

        var storedRec = collection.where({id: id});
        if (storedRec.items.length > 0) {
            log.debug('[DB] ID (%d) already exists in database.  Skipping.', id);
            return false;
        }
        collection.insert(data); // Insert/add/push only one element
        collection.save();
        log.info('[DB] Added new item to database: ', data);
        return true
    } catch(error) {
        log.error('[DB] Error occurred while writing data to databae: %s', error);
        return false;
    }
}

function sendEmail(data) {
    log.debug('[Email] Building email to send');

    var nodemailer = require('nodemailer');

    var transporter = nodemailer.createTransport({
        service: 'Gmail',
        auth: {
            user: cfg.mail.username,
            pass: cfg.mail.password
        },
        logger: true, // log to console
        debug: true // include SMTP traffic in the logs
    }, {
        to: cfg.mail.recipients
    });

    var message = {
        to: cfg.mail.recipients,
        subject: util.format(cfg.mail.subject.text, data[cfg.mail.subject.attribute]),
        html: buildHtmlMessage(data).toString()
    };
    try {
        log.debug('[Email] Sending Email: ', message);
        transporter.sendMail(message, function (error, info){
            if (error){
                log.error('[Email] %s', error);
                return;
            }
            log.info('[Email]: Message sent: %s', info.response);
        });
    } catch(error) {
        log.error('[Email]: %s', error);
    }
}

function getConfig() {
    var fs = require('fs');
    return JSON.parse(fs.readFileSync('monitor.json', 'utf8'));
}

function refreshConfig() {
    log.debug('[Config] Started refreshing configuration');
    cfg = getConfig();
    log.transports.console.silent = !cfg.logging.console_out;
    if (cfg.logging.level) { log.transports.console.level = cfg.logging.level; log.transports.file.level = cfg.logging.level; }
    if (cfg.logging.filename) { log.transports.file.filename = cfg.logging.filename; }
    log.debug('[Config] Finished refreshing configuration');
}

function getDateTime() {
    var date = new Date();

    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;

    var min  = date.getMinutes();
    min = (min < 10 ? "0" : "") + min;

    var sec  = date.getSeconds();
    sec = (sec < 10 ? "0" : "") + sec;

    var year = date.getFullYear();

    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;

    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;

    return year + ":" + month + ":" + day + ":" + hour + ":" + min + ":" + sec;
}