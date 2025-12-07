const fetch = require('node-fetch');
const prompt = require('prompt-sync')({ sigint: true });

async function getUserInfo(baseSite, cookie) {
    let user = await fetch(`https://${baseSite}/api/v5/user`, { headers: { cookie: '_bsw_session_v1_production=' + cookie } });
    if (user.status != 200) {
        throw new Error("Bad cookie or invalid session");
    }
    return user.json();
}

async function getBooks(baseSite, headers) {
    let books = await fetch(`https://${baseSite}/api/v6/books?page_thumb_size=medium&per_page=25000`, { headers }).then(res => res.json());

    let preactivations = await fetch(`https://${baseSite}/api/v5/books/preactivations`, { headers }).then(res => res.json());

    preactivations.forEach(preactivation => {
        if (preactivation.no_bsmart === false) {
            books.push(...preactivation.books);
        }
    });
    return books;
}

async function getBookDetails(baseSite, bookId, headers) {
    let book = await fetch(`https://${baseSite}/api/v6/books/by_book_id/${bookId}`, { headers });
    if (book.status != 200) {
        throw new Error("Invalid book id");
    }
    return book.json();
}

async function getBookResources(baseSite, book, headers) {
    let info = [];
    let page = 1;
    while (true) {
        let tempInfo = await fetch(`https://${baseSite}/api/v5/books/${book.id}/${book.current_edition.revision}/resources?per_page=500&page=${page}`, { headers }).then(res => res.json());
        info = info.concat(tempInfo);
        if (tempInfo.length < 500) break;
        page++;
    }
    return info;
}

module.exports = {
    getUserInfo,
    getBooks,
    getBookDetails,
    getBookResources
};
