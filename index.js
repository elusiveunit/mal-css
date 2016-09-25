'use strict';

const fs = require('fs');
const request = require('request');
const cheerio = require('cheerio');
const Datastore = require('nedb');
const exec = require('child_process').exec;

// Force enable for Cygwin that will otherwise require --color flag
const chalkDep = require('chalk');
const chalk = new chalkDep.constructor({ enabled: true });

// CLI arguments
const argv = require('yargs')
  .usage('$0 <command> [options]')
  .command('ids', 'Get all the anime IDs from an anime list')
  .command('images', 'Get the main anime image for each saved anime ID')
  .command('css', 'Generate a CSS file from saved anime images')
  .command('full', 'Run all commands')
  .option('u', {
    alias: 'user',
    demand: false,
    describe: 'MyAnimeList user name. Overrides config.json.',
    type: 'string'
  })
  .option('r', {
    alias: 'refetch',
    default: false,
    describe: 'Force fetching of all anime, even if there are image URLs saved',
    type: 'boolean'
  })
  .help()
  .alias('h', 'help')
  .demand(1)
  .strict()
  .argv;

let isFullRun = false;

// Optional config file
const configPath = 'config.json';
const config = {};
let configFileData = {};

// Database files
let db_ids;
let db_anime;
let totalIdCount = 0;

const listBase = 'http://myanimelist.net/animelist/';
const animeBase = 'http://myanimelist.net/anime/';
const maxId = 33000;



/* ---------- Util ---------- */

function arrayHas(arr, val) {
  return (arr.indexOf(val) !== -1);
}

function findDocById(docs, id) {
  for (let i = docs.length - 1; i >= 0; i--) {
    if (id === docs[i]._id) {
      return docs[i];
    }
  }

  return false;
}

function getListUrl() {
  return listBase + config.user;
}

function getAnimeUrl(id) {
  return animeBase + id;
}

function copyFile(src, dest, cb) {
  const readStream = fs.createReadStream(src);
  readStream.on('error', (error) => {
    console.log(chalk.red(`copyFile: couldn't read ${src}`));
    throw error;
  });

  const writeStream = fs.createWriteStream(dest);
  writeStream.on('error', (error) => {
    console.log(chalk.red(`copyFile: couldn't write ${dest}`));
    throw error;
  });

  readStream.pipe(writeStream);

  writeStream.on('close', () => {
    console.log(chalk.green(`Copied ${src} to ${dest}`));
    if ('function' === typeof cb) {
      cb(src, dest);
    }
  });
}



/* ---------- Requests ---------- */

let requestCount = 0;
let maxConcurrent = 3;
let requestQueue = [];

function addToQueue(url, cb) {
  requestQueue.push({url: url, cb: cb});
}
function getFromQueue() {
  return requestQueue.shift();
}

function fetchPageBody(url, cb) {
  if (requestCount >= maxConcurrent) {
    addToQueue(url, cb);
  } else {
    requestCount++;
    request(url, (error, response, body) => {
      if (!error && response.statusCode === 200) {
        cb(body);
      } else if (error) {
        console.log(chalk.red('Error: ' + error));
      } else {
        console.log(chalk.red('Got response code ' + response.statusCode));
      }

      if (requestCount <= maxConcurrent) {
        const queued = getFromQueue();

        if (queued) {
          fetchPageBody(queued.url, queued.cb);
        }
      }

      requestCount--;
    });
  }
}



/* ---------- Fetch anime IDs ---------- */

function saveAnimeIdsFromList(html) {
  const $ = cheerio.load(html);
  const links = $('.animetitle');

  links.each((i, el) => {
    const id = parseInt($(el).attr('href').split('/').filter(Boolean)[1], 10);

    db_ids.insert({
      _id: id
    });
  });

  console.log(chalk.green(`Saved ${links.length} anime IDs.`));

  if (isFullRun) {
    console.log(''); /* Newline */
    fetchAnimeData();
  }
}

function fetchAnimeListIds() {
  console.log(chalk.cyan(`Fetching anime list IDs for user '${config.user}'...`));
  fetchPageBody(getListUrl(), saveAnimeIdsFromList);
}



/* ---------- Fetch anime data ---------- */

let savedCount = 0;

function saveAnimeData(id, html) {
  const $ = cheerio.load(html);
  const title = $('h1').text();
  const $image = $('.borderClass').first().find('img').first();

  let imageUrl = $image.attr('src');
  if (!imageUrl) {
    imageUrl = $image.attr('data-src');
  }

  db_anime.insert({
    _id: id,
    title: title,
    imageUrl: imageUrl
  });
  savedCount++;

  console.log(chalk.white(`[${savedCount}/${totalIdCount}] Saved '${title}'`));

  if (isFullRun && savedCount === totalIdCount) {
    console.log(''); /* Newline */
    generateCSS();
  }
}

function fetchSingleAnimeData(id) {
  fetchPageBody(getAnimeUrl(id), saveAnimeData.bind(null, id));
}

function fetchAllAnimeData(skip) {
  if (skip && skip.length === totalIdCount) {
    console.log(chalk.green(`All anime data for user '${config.user}' already fetched!`));

    if (isFullRun) {
      console.log(''); /* Newline */
      generateCSS();
    }

    return;
  }

  console.log(chalk.cyan(`Fetching anime data for user '${config.user}'. This may take several minutes.`));

  db_ids.find({}, (error, docs) => {
    if (error) {throw error;}

    if (!docs.length) {
      throw new Error(`Couldn't get any IDs for user '${config.user}'`);
    }

    docs.map((doc) => {

      // Already has data, skip
      if (skip && findDocById(skip, doc._id)) {
        savedCount++;
        return;
      }

      fetchSingleAnimeData(doc._id);
    });
  });
}

function fetchAnimeData() {
  if (!config.forceRefetch) {
    db_anime.find({}, (error, docs) => {
      if (error) {throw error;}

      fetchAllAnimeData(docs);
    });
  } else {
    fetchAllAnimeData();
  }
}



/* ---------- Generate CSS ---------- */

function generateCSS() {
  console.log(chalk.cyan('Generating CSS...'));

  db_anime.find({}, (error, docs) => {
    if (error) {throw error;}

    if (!docs.length) {
      throw new Error(`Couldn't get any anime data for user '${config.user}'`);
    }

    let output = '';

    docs.map((doc) => {
      output += `a[href^="/anime/${doc._id}/"]{background-image:url('${doc.imageUrl}')}\n`;
    });

    fs.writeFile(`data/${config.user}.css`, output, (error) => {
      if (error) {throw error;}

      console.log(chalk.green(`Saved data/${config.user}.css!`));

      copyGeneratedCSS();
    });
  });
}

function copyGeneratedCSS() {
  copyFile(
    `data/${config.user}.css`,
    'css/generated/_anime-images.scss',
    buildCSS
  );
}

function buildCSS() {
  exec('grunt css', (error, stdout, stderr) => {
    if (error) {
      console.log(chalk.red('buildCSS failed'));
      throw error;
    } else {
      console.log(chalk.green('Built css/material-cards.min.css with Grunt!'));
      copyBuiltCSS();
    }
  });
}

function copyBuiltCSS() {
  if (configFileData.cssPath) {
    copyFile(
      'css/material-cards.min.css',
      configFileData.cssPath.replace(/\/\\$/, '') + '\\material-cards.min.css'
    );
  }
}


/* ---------- Setup and run ---------- */

function runCommands() {
  switch (argv._[0]) {
    case 'ids':
      fetchAnimeListIds();
      break;

    case 'images':
      fetchAnimeData();
      break;

    case 'css':
      generateCSS();
      break;

    case 'full':
      isFullRun = true;
      fetchAnimeListIds();
      break;

    default:
      console.log(chalk.yellow('Invalid command'));
  }
}

function countSavedIds() {
  db_ids.count({}, (error, count) => {
    if (error) {throw error;}

    totalIdCount = count;
    runCommands();
  });
}

function setDataStores() {
  db_ids = new Datastore({ filename: `data/${config.user}_ids`, autoload: true });
  db_anime = new Datastore({ filename: `data/${config.user}_anime`, autoload: true });
}

function setConfig() {
  config.forceRefetch = argv.r;

  if (argv.u) {
    config.user = argv.u;
  } else if (configFileData.user) {
    config.user = configFileData.user;
  } else {
    console.log(chalk.red('Missing user name'));
    process.exit(1);
  }

  setDataStores();
  countSavedIds();
}

function readConfig() {
  fs.stat(configPath, (error, stats) => {
    if (error || !stats.isFile()) {
      setConfig();
    } else {
      fs.access(configPath, fs.R_OK, (error) => {
        if (error) {
          setConfig();
        } else {
          fs.readFile(configPath, (error, data) => {
            if (!error) {
              configFileData = JSON.parse(data);
            }

            setConfig();
          });
        }
      });
    }
  });
}

function run() {
  readConfig();
}

run();