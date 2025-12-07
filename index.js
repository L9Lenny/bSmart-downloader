const prompt = require('prompt-sync')({ sigint: true });
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const md5 = require('md5');
const sanitize = require("sanitize-filename");
const cliProgress = require('cli-progress');

const api = require('./src/api');
const crypto = require('./src/crypto');
const pdf = require('./src/pdf');

const argv = yargs(process.argv.slice(2))
    .option('site', {
        describe: 'The site to download from, currently either bsmart or digibook24',
        type: 'string',
        default: null
    })
    .option('siteUrl', {
        describe: 'This overwrites the base url for the site, useful in case a new platform is added',
        type: 'string',
        default: null
    })
    .option('cookie', {
        describe: 'Input "_bsw_session_v1_production" cookie',
        type: 'string',
        default: null
    })
    .option('bookId', {
        describe: 'Book id',
        type: 'string',
        default: null
    })
    .option('downloadOnly', {
        describe: 'Downloads the pages as individual pdfs and will provide a command that can be used to merge them with pdftk',
        type: 'boolean',
        default: false
    })
    .option('pdftk', {
        describe: 'Downloads the pages as individual pdfs and merges them with pdftk',
        type: 'boolean',
        default: false
    })
    .option('pdftkPath', {
        describe: 'Path to pdftk executable',
        type: 'string',
        default: 'pdftk'
    })
    .option('checkMd5', {
        describe: 'Checks the md5 hash of the downloaded pages',
        type: 'boolean',
        default: false
    })
    .option('output', {
        describe: 'Output filename',
        type: 'string',
        default: null
    })
    .option('resources', {
        describe: 'Download resources of the book instrad of the book it self',
        type: 'boolean',
        default: false
    })
    .option('concurrency', {
        describe: 'Number of parallel downloads',
        type: 'number',
        default: 10
    })
    .help()
    .argv;

(async () => {
    // Dynamic import for p-limit
    const pLimit = (await import('p-limit')).default;

    if (argv.downloadOnly && argv.pdftk) {
        console.log("Can't use --download-only and --pdftk at the same time");
        return;
    }

    if ((argv.downloadOnly || argv.pdftk) && !fs.existsSync('temp')) {
        fs.mkdirSync('temp');
    }

    if ((argv.downloadOnly || argv.pdftk) && fs.readdirSync('temp').length > 0) {
        console.log("Files already in temp folder, please manually delete them if you want to download a new book");
        return;
    }

    let baseSite = argv.siteUrl;

    if (!baseSite) {
        let platform = argv.site;
        while (!platform) {
            platform = prompt('Input site (bsmart or digibook24):');
            if (platform != 'bsmart' && platform != 'digibook24') {
                platform = null;
                console.log('Invalid site');
            }
        }
        baseSite = platform == 'bsmart' ? 'www.bsmart.it' : 'web.digibook24.com';
    }

    let cookie = argv.cookie;
    while (!cookie) {
        cookie = prompt('Input "_bsw_session_v1_production" cookie:');
    }

    try {
        let user = await api.getUserInfo(baseSite, cookie);
        let headers = { "auth_token": user.auth_token };

        let books = await api.getBooks(baseSite, headers);

        if (books.length == 0) {
            console.log('No books in your library!');
        } else {
            console.log("Book list:");
            console.table(books.map(book => ({ id: book.id, title: book.title })))
        }

        let bookId = argv.bookId;
        while (!bookId) {
            bookId = prompt(`Please input book id${(books.length == 0 ? " manually" : "")}:`);
        }

        console.log(`Fetching book info...`);
        let book = await api.getBookDetails(baseSite, bookId, headers);

        console.log(`Fetching resources list...`);
        let info = await api.getBookResources(baseSite, book, headers);

        const outputPdf = await pdf.createPdf();
        const writeAwaitng = [];
        const filenames = [];
        const outputname = argv.output || sanitize(book.id + " - " + book.title);

        let assets = info.map(e => e.assets).flat();

        console.log('Fetching encryption key...');
        await crypto.fetchEncryptionKey();

        if (argv.resources) {
            assets = assets.filter(e => e.use == "launch_file");
            if (!fs.existsSync(outputname)) {
                fs.mkdirSync(outputname);
            }
            console.log("Preparing to download resources...");
        } else {
            assets = assets.filter(e => e.use == "page_pdf");
            console.log("Preparing to download pages...");
        }

        const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        bar1.start(assets.length, 0);

        const limit = pLimit(argv.concurrency);

        const tasks = assets.map((asset, i) => {
            return limit(async () => {
                try {
                    let data = await fetch(asset.url).then(res => res.buffer());

                    if (argv.resources) {
                        if (asset.encrypted !== false) {
                            data = await crypto.decryptFile(data).catch((e) => {
                                console.log("\nError Decrypting resource", i, asset.url);
                            });
                        }
                    } else {
                        data = await crypto.decryptFile(data).catch((e) => {
                            console.log("\nError Decrypting page", i, asset.url);
                        });
                    }

                    if (argv.checkMd5 && md5(data) != asset.url) {
                        console.log("\nMismatching md5 hash", i, asset.url);
                    }

                    bar1.increment();
                    return { index: i, data, asset };
                } catch (e) {
                    console.error(`\nError downloading asset ${i}:`, e.message);
                    bar1.increment();
                    return { index: i, data: null, asset, error: e };
                }
            });
        });

        const results = await Promise.all(tasks);
        bar1.stop();

        console.log("Processing downloaded data...");

        for (const res of results) {
            if (!res || !res.data) continue;

            if (argv.resources) {
                let filename = path.basename(res.asset.filename);
                writeAwaitng.push(fs.promises.writeFile(`${outputname}/${filename}`, res.data));
            } else {
                if (argv.downloadOnly || argv.pdftk) {
                    let filename = path.basename(res.asset.filename, '.pdf');
                    writeAwaitng.push(fs.promises.writeFile(`temp/${filename}.pdf`, res.data));
                    filenames.push(`temp/${filename}.pdf`);
                } else {
                    await pdf.addPageToPdf(outputPdf, res.data);
                }
            }
        }

        await Promise.all(writeAwaitng);

        if (argv.resources) {
            console.log("Resources saved.");
        } else if (!argv.downloadOnly && !argv.pdftk) {
            console.log("Saving PDF...");
            await pdf.savePdf(outputPdf, outputname);
            console.log("PDF Saved.");
        } else {
            if (argv.pdftk) {
                await pdf.mergePdfWithPdftk(argv.pdftkPath, filenames, outputname);
            } else {
                let pdftkCommand = `${argv.pdftkPath} ${filenames.join(' ')} cat output "${outputname}.pdf"`;
                console.log("Run this command to merge the pages with pdftk:");
                console.log(pdftkCommand);
            }
        }

        console.log("Done");

    } catch (e) {
        console.error("An error occurred:", e);
    }

})();
