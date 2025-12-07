const msgpack = require('msgpack-lite');
const aesjs = require('aes-js');
const fetch = require('node-fetch');

// This variable will be set by fetchEncryptionKey
let key = null;

async function fetchEncryptionKey() {
    try {
        let page = await fetch('https://my.bsmart.it/');
        let text = await page.text();
        let script = text.match(/<script src="(\/scripts\/.*.min.js)">/)[1];
        let scriptText = await fetch('https://my.bsmart.it' + script).then(res => res.text());
        let keyScript = scriptText.slice(scriptText.indexOf('var i=String.fromCharCode'));
        keyScript = keyScript.slice(0, keyScript.indexOf('()'));
        let sourceCharacters = keyScript.match(/var i=String.fromCharCode\((((\d+),)+(\d+))\)/)[1].split(',').map(e => parseInt(e)).map(e => String.fromCharCode(e));
        let map = keyScript.match(/i\[\d+\]/g).map(e => parseInt(e.slice(2, -1)));
        let snippet = map.map(e => sourceCharacters[e]).join('');
        key = Buffer.from(snippet.match(/'((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)'/)[1], 'base64');
        return key;
    } catch (e) {
        console.error("Error fetching encryption key:", e);
        throw e;
    }
}

async function decryptFile(file) {
    return new Promise(async (resolve, reject) => {
        try {
            if (!key) {
                await fetchEncryptionKey();
            }

            let header = msgpack.decode(file.slice(0, 256));

            let firstPart = file.slice(256, header.start);
            let secondPart = new Uint8Array(file.slice(header.start));

            var aesCbc = new aesjs.ModeOfOperation.cbc(key, firstPart.slice(0, 16));
            var decryptedFirstPart = aesCbc.decrypt(firstPart.slice(16));

            for (let i = 16; i > 0; i--) {
                if (decryptedFirstPart.slice(decryptedFirstPart.length - i).every(e => e == i)) {
                    decryptedFirstPart = decryptedFirstPart.slice(0, decryptedFirstPart.length - i);
                    break;
                }
            }

            let result = new Uint8Array(decryptedFirstPart.length + secondPart.length);
            result.set(decryptedFirstPart);
            result.set(secondPart, decryptedFirstPart.length);
            resolve(result);
        } catch (e) {
            reject({ e, file })
        }
    });
}

module.exports = {
    fetchEncryptionKey,
    decryptFile
};
