var axios = require('axios');

var BASE_URL = 'https://fapi.binance.com';

function getKlines(symbol, interval, limit) {
    return axios.get(BASE_URL + '/fapi/v1/klines', {
        params: {
            symbol: symbol,
            interval: interval,
            limit: limit || 500
        }
    }).then(function (response) {
        return response.data.map(function (item) {
            return {
                openTime: item[0],
                open: Number(item[1]),
                high: Number(item[2]),
                low: Number(item[3]),
                close: Number(item[4]),
                volume: Number(item[5]),
                closeTime: item[6]
            };
        });
    });
}

function getExchangeInfo() {
    return axios.get(BASE_URL + '/fapi/v1/exchangeInfo')
        .then(function (response) {
            return response.data;
        });
}

module.exports = {
    getExchangeInfo: getExchangeInfo,
    getKlines: getKlines
};
