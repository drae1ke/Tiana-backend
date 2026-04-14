/**
 * utils/mpesa.js
 * CommonJS version — compatible with the rest of the Express/CommonJS backend.
 */

const axios = require('axios');

const BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

/**
 * Fetch a short-lived OAuth2 access token from Safaricom.
 */
const generateAccessToken = async () => {
  const credentials = Buffer.from(
    `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
  ).toString('base64');

  const { data } = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` } }
  );

  if (!data.access_token) {
    throw new Error('Failed to obtain MPesa access token');
  }

  return data.access_token;
};

/**
 * Build the timestamp (YYYYMMDDHHmmss) and base64-encoded password
 * required by the STK Push API.
 */
const getStkCredentials = () => {
  const now = new Date();
  // Format: YYYYMMDDHHmmss
  const timestamp = now
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);

  const rawPassword = `${process.env.BUSINESS_SHORT_CODE}${process.env.PASSKEY}${timestamp}`;
  const password = Buffer.from(rawPassword).toString('base64');

  return { timestamp, password };
};

/**
 * Trigger a Lipa Na M-Pesa Online (STK Push) payment request.
 *
 * @param {number} amount          - Amount in KES (integer).
 * @param {string} phoneNumber     - Customer phone in format 254XXXXXXXXX.
 * @param {string} accountReference - A short reference shown on the customer's phone.
 * @returns {Promise<object>}      - Safaricom API response data.
 */
const initiateStkPush = async (amount, phoneNumber, accountReference = 'AgrovetPOS') => {
  // Normalise phone: strip leading 0 or + and prepend 254
  let phone = String(phoneNumber).replace(/\s+/g, '');
  if (phone.startsWith('+')) phone = phone.slice(1);
  if (phone.startsWith('0'))  phone = '254' + phone.slice(1);

  const accessToken = await generateAccessToken();
  const { timestamp, password } = getStkCredentials();

  const payload = {
    BusinessShortCode: process.env.BUSINESS_SHORT_CODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerPayBillOnline',
    Amount:            Math.ceil(Number(amount)), // must be integer
    PartyA:            phone,
    PartyB:            process.env.BUSINESS_SHORT_CODE,
    PhoneNumber:       phone,
    CallBackURL:       `${process.env.BASE_URL}/api/mpesa/stk-callback`,
    AccountReference:  accountReference.slice(0, 12), // max 12 chars
    TransactionDesc:   'Payment for goods',
  };

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return data;
};

module.exports = { generateAccessToken, getStkCredentials, initiateStkPush };