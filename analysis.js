const fs = require("fs");
const axios = require("axios")

function currentDate() {
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function readJSON(file) {
    return JSON.parse(fs.readFileSync(file));
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function sparToCanonical(rawItems, today) {
    const canonicalItems = [];
    for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i];

        let price, unit;
        if (item.masterValues["quantity-selector"]) {
            const [str_price, str_unit] = item.masterValues["price-per-unit"].split('/');
            price = parseFloat(str_price.replace("€", ""));
            unit = str_unit.trim();
        }
        else {
            price = item.masterValues.price;
            unit = item.masterValues["short-description-3"];
            if (!unit) unit = "";
        }
        canonicalItems.push({
            store: "spar",
            id: item.masterValues["code-internal"],
            name: item.masterValues.title + " " + item.masterValues["short-description"],
            price,
            priceHistory: [{ date: today, price }],
            unit,
            bio: item.masterValues.biolevel === "Bio"
        });
    }
    return canonicalItems;
}

function billaToCanonical(rawItems, today) {
    const canonicalItems = [];
    for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i];
        canonicalItems.push({
            store: "billa",
            id: item.data.articleId,
            name: item.data.name,
            price: item.data.price.final,
            priceHistory: [{ date: today, price: item.data.price.final }],
            unit: item.data.grammagePriceFactor == 1 ? item.data.grammage : "kg",
            bio: item.data.attributes && item.data.attributes.includes("s_bio")
        });
    }
    return canonicalItems;
}

function hoferToCanonical(rawItems, today) {
    const canonicalItems = [];
    for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i];
        canonicalItems.push({
            store: "hofer",
            id: item.ProductID,
            name: item.ProductName,
            price: item.Price,
            priceHistory: [{ date: today, price: item.Price }],
            unit: `${item.Unit} ${item.UnitType}`,
            bio: item.IsBio
        });
    }
    return canonicalItems;
}

function dmToCanonical(rawItems, today) {
    const canonicalItems = [];
    for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i];
        canonicalItems.push({
            store: "dm",
            id: item.gtin,
            name: `${item.brandName} ${item.title}`,
            price: item.price.value,
            priceHistory: [{ date: today, price: item.price.value }],
            unit: `${item.netQuantityContent} ${item.contentUnit}`,
            ...(item.brandName === "dmBio" || (item.name ? (item.name.startsWith("Bio ") | item.name.startsWith("Bio-")) : false)) && {bio: true},
        });
    }

    return canonicalItems;
}

async function fetchHofer() {
    const BASE_URL = `https://shopservice.roksh.at`
    const CATEGORIES = BASE_URL + `/category/GetFullCategoryList/`
    const CONFIG = { headers: { authorization: null } }
    const ITEMS = BASE_URL + `/productlist/CategoryProductList`

    // fetch access token
    const token_data = { "OwnWebshopProviderCode": "", "SetUserSelectedShopsOnFirstSiteLoad": true, "RedirectToDashboardNeeded": false, "ShopsSelectedForRoot": "hofer", "BrandProviderSelectedForRoot": null, "UserSelectedShops": [] }
    const token = (await axios.post("https://shopservice.roksh.at/session/configure", token_data, { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' } })).headers['jwt-auth'];
    CONFIG.headers.authorization = "Bearer " + token;

    // concat all subcategories (categories.[i].ChildList)
    const categories = (await axios.post(CATEGORIES, {}, CONFIG)).data;
    const subCategories = categories.reduce((acc, category) => acc.concat(category.ChildList), []);

    let hoferItems = [];
    for (let subCategory of subCategories) {
        let categoryData = (await axios.get(`${ITEMS}?progId=${subCategory.ProgID}&firstLoadProductListResultNum=4&listResultProductNum=24`, CONFIG)).data;
        const numPages = categoryData.ProductListResults[0].ListContext.TotalPages;

        for (let iPage = 1; iPage <= numPages; iPage++) {
            let items = (await axios.post(`${BASE_URL}/productlist/GetProductList`, { CategoryProgId: subCategory.ProgID, Page: iPage }, CONFIG)).data;
            hoferItems = hoferItems.concat(items.ProductList);
        }
    }

    return hoferItems;
}

async function fetchDm() {
    // The DM API is pretty aggressive regarding rate limiting, also, every query returns at most 1000 items,
    // so we have to split the queries into multiple ones.
    const BASE_URL = `https://product-search.services.dmtech.com/at/search/crawl?pageSize=1000&`
    const QUERIES = [
        'allCategories.id=010000&price.value.to=2', //~500 items
        'allCategories.id=010000&price.value.from=2&price.value.to=3', //~600 items
        'allCategories.id=010000&price.value.from=3&price.value.to=4', //~500 items
        'allCategories.id=010000&price.value.from=4&price.value.to=7', //~800 items
        'allCategories.id=010000&price.value.from=7&price.value.to=10', //~900 items
        'allCategories.id=010000&price.value.from=10&price.value.to=15', //~900 items
        'allCategories.id=010000&price.value.from=15', //~300 items
        'allCategories.id=020000&price.value.to=2', //~600 items
        'allCategories.id=020000&price.value.from=2&price.value.to=3', //~550 items
        'allCategories.id=020000&price.value.from=3&price.value.to=4', //~600 items
        'allCategories.id=020000&price.value.from=4&price.value.to=6', //~800 items
        'allCategories.id=020000&price.value.from=6&price.value.to=10', //~850 items
        'allCategories.id=020000&price.value.from=10&price.value.to=18', //~900 items
        'allCategories.id=020000&price.value.from=18', //~960 items (!)
        'allCategories.id=030000&price.value.to=8', //~900 items
        'allCategories.id=030000&price.value.from=8', //~500 items
        'allCategories.id=040000&price.value.to=2', //~600 items
        'allCategories.id=040000&price.value.from=2&price.value.to=4', //~900 items
        'allCategories.id=040000&price.value.from=4', //~400 items
        'allCategories.id=050000&price.value.to=4', //~600 items
        'allCategories.id=050000&price.value.from=4', //~800 items
        'allCategories.id=060000&price.value.to=4', //~900 items
        'allCategories.id=060000&price.value.from=4', //~500 items
        'allCategories.id=070000', //~300 items
    ]

    let dmItems = [];
    for (let query of QUERIES) {
        var res = (await axios.get(BASE_URL + query, {
            validateStatus: function (status) {
                return (status >= 200 && status < 300) || status == 429;
            }
        }));

        // exponential backoff
        backoff = 2000;
        while (res.status == 429) {
            console.info(`DM API returned 429, retrying in ${backoff/1000}s.`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            backoff *= 2;
            res = (await axios.get(BASE_URL + query, {
                validateStatus: function (status) {
                    return (status >= 200 && status < 300) || status == 429;
                }
            }));
        }
        let items = res.data;
        if (items.count > 1000) {
            console.warn(`Query returned more than 1000 items! Items may be missing. Adjust queries. Query: ${query}`);
        }
        dmItems = dmItems.concat(items.products);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return dmItems;
}

function mergePriceHistory(oldItems, items) {
    if (oldItems == null) return items;

    const lookup = {}
    for (oldItem of oldItems) {
        lookup[oldItem.store + oldItem.id] = oldItem;
    }

    for (item of items) {
        let oldItem = lookup[item.store + item.id];
        let currPrice = item.priceHistory[0];
        if (oldItem) {
            if (oldItem.priceHistory[0].price == currPrice.price) {
                item.priceHistory = oldItem.priceHistory;
                continue;
            }

            for (oldPrice of oldItem.priceHistory) {
                item.priceHistory.push(oldPrice);
            }
        }
    }

    return items;
}

/// Given a directory of raw data of the form `billa-$date.json` and `spar-$date.json`, constructs
/// a canonical list of all products and their historical price data.
exports.replay = function(rawDataDir) {
    const today = currentDate();

    const files = fs.readdirSync(rawDataDir).filter(
        file => file.indexOf("canonical") == -1 && (file.indexOf("billa-") == 0 || file.indexOf("spar") == 0 || file.indexOf("hofer") == 0)
    );

    const dateSort = (a, b) => {
        const dateA = new Date(a.match(/\d{4}-\d{2}-\d{2}/)[0]);
        const dateB = new Date(b.match(/\d{4}-\d{2}-\d{2}/)[0]);
        return dateA - dateB;
    };
    const sparFiles = files.filter(file => file.indexOf("spar-") == 0).sort(dateSort).map(file => rawDataDir + "/" + file);
    const sparFilesCanonical = sparFiles.map(file => sparToCanonical(readJSON(file), file.match(/\d{4}-\d{2}-\d{2}/)[0]));
    const billaFiles = files.filter(file => file.indexOf("billa-") == 0).sort(dateSort).map(file => rawDataDir + "/" + file);
    const billaFilesCanonical = billaFiles.map(file => billaToCanonical(readJSON(file), file.match(/\d{4}-\d{2}-\d{2}/)[0]));
    const hoferFiles = files.filter(file => file.indexOf("hofer-") == 0).sort(dateSort).map(file => rawDataDir + "/" + file);
    const hoferFilesCanonical = hoferFiles.map(file => hoferToCanonical(readJSON(file), file.match(/\d{4}-\d{2}-\d{2}/)[0]));
    const dmFiles = files.filter(file => file.indexOf("dm-") == 0).sort(dateSort).map(file => rawDataDir + "/" + file);
    const dmFilesCanonical = dmFiles.map(file => dmToCanonical(readJSON(file), file.match(/\d{4}-\d{2}-\d{2}/)[0]));

    const allFilesCanonical = [];
    const len = Math.max(Math.max(sparFilesCanonical.length, Math.max(billaFilesCanonical.length, hoferFilesCanonical.length)), dmFilesCanonical.length);
    sparFilesCanonical.reverse();
    billaFilesCanonical.reverse();
    hoferFilesCanonical.reverse();
    dmFilesCanonical.reverse();
    for (let i = 0; i < len; i++) {
        const canonical = [];
        let billa = billaFilesCanonical.pop();
        if (billa) canonical.push(...billa);
        let spar = sparFilesCanonical.pop();
        if (spar) canonical.push(...spar);
        let hofer = hoferFilesCanonical.pop();
        if (hofer) canonical.push(...hofer);
        allFilesCanonical.push(canonical);
        let dm = dmFilesCanonical.pop();
        if (dm) canonical.push(...dmFilesCanonical.pop());
        allFilesCanonical.push(canonical);
    }

    if (allFilesCanonical.length == 0) return null;
    if (allFilesCanonical.length == 1) return allFilesCanonical[0];

    let prev = allFilesCanonical[0];
    let curr = null;
    for (let i = 1; i < allFilesCanonical.length; i++) {
        curr = allFilesCanonical[i];
        mergePriceHistory(prev, curr);
        prev = curr;
    }
    return curr;
}

const HITS = Math.floor(30000 + Math.random() * 2000);
const SPAR_SEARCH = `https://search-spar.spar-ics.com/fact-finder/rest/v4/search/products_lmos_at?query=*&q=*&page=1&hitsPerPage=${HITS}`;
const BILLA_SEARCH = `https://shop.billa.at/api/search/full?searchTerm=*&storeId=00-10&pageSize=${HITS}`;

exports.updateData = async function (dataDir, done) {
    const today = currentDate();
    console.log("Fetching data for date: " + today);

    let start = performance.now();
    const sparItems = (await axios.get(SPAR_SEARCH)).data.hits;
    fs.writeFileSync(`${dataDir}/spar-${today}.json`, JSON.stringify(sparItems, null, 2));
    const sparItemsCanonical = sparToCanonical(sparItems, today);
    console.log("Fetched SPAR data, took " + (performance.now() - start) / 1000 + " seconds");

    start = performance.now();
    const billaItems = (await axios.get(BILLA_SEARCH)).data.tiles;
    fs.writeFileSync(`${dataDir}/billa-${today}.json`, JSON.stringify(billaItems, null, 2));
    const billaItemsCanonical = billaToCanonical(billaItems, today);
    console.log("Fetched BILLA data, took " + (performance.now() - start) / 1000 + " seconds");

    start = performance.now();
    const hoferItems = await fetchHofer();
    fs.writeFileSync(`${dataDir}/hofer-${today}.json`, JSON.stringify(hoferItems, null, 2));
    const hoferItemsCanonical = hoferToCanonical(hoferItems, today);
    console.log("Fetched HOFER data, took " + (performance.now() - start) / 1000 + " seconds");

    start = performance.now();
    const dmItems = await fetchDm();
    fs.writeFileSync(`${dataDir}/dm-${today}.json`, JSON.stringify(dmItems, null, 2));
    const dmItemsCanonical = dmToCanonical(dmItems, today);
    console.log("Fetched DM data, took " + (performance.now() - start) / 1000 + " seconds");

    const items = [...billaItemsCanonical, ...sparItemsCanonical, ...hoferItemsCanonical, ...dmItemsCanonical];
    if (fs.existsSync(`${dataDir}/latest-canonical.json`)) {
        const oldItems = JSON.parse(fs.readFileSync(`${dataDir}/latest-canonical.json`));
        mergePriceHistory(oldItems, items);
        console.log("Merged price history");
    }
    fs.writeFileSync(`${dataDir}/latest-canonical.json`, JSON.stringify(items, null, 2));

    if (done) done(items);
    return items;
}
