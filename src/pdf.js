const { PDFDocument } = require('pdf-lib');
const md5 = require('md5');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function createPdf() {
    return await PDFDocument.create();
}

async function addPageToPdf(outputPdf, pageData) {
    const page = await PDFDocument.load(pageData);
    const [firstDonorPage] = await outputPdf.copyPages(page, [0]);
    outputPdf.addPage(firstDonorPage);
}

async function savePdf(outputPdf, outputFilename) {
    await fs.promises.writeFile(outputFilename + ".pdf", await outputPdf.save());
}

function checkMd5(data, expectedHash) {
    return md5(data) === expectedHash;
}

async function mergePdfWithPdftk(pdftkPath, filenames, outputFilename) {
    return new Promise((resolve, reject) => {
        console.log("Merging pages with pdftk");
        let pdftk = spawn(pdftkPath, filenames.concat(['cat', 'output', outputFilename + ".pdf"]));
        pdftk.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });
        pdftk.stderr.on('data', (data) => {
            console.log(`stderr: ${data}`);
        });
        pdftk.on('close', (code) => {
            if (code === 0) {
                console.log(`child process exited with code ${code}`);
                resolve();
            } else {
                reject(new Error(`pdftk exited with code ${code}`));
            }
        });
    });
}

module.exports = {
    createPdf,
    addPageToPdf,
    savePdf,
    checkMd5,
    mergePdfWithPdftk
};
