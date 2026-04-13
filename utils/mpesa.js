import axios from 'axios';
import crypto from 'crypto';

const BASE_URL = 'https://sandbox.safaricom.co.ke';

// Generate OAuth token
export const generateAccessToken = async () => {
  const auth = Buffer.from(
    `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
  ).toString('base64');

  const { data } = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return data.access_token;
};

// Build timestamp and password for STK push
export const getStkCredentials = () => {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);

  const password = Buffer.from(
    `${process.env.BUSINESS_SHORT_CODE}${process.env.PASSKEY}${timestamp}`
  ).toString('base64');

  return { timestamp, password };
};

// Initiate STK push
export const initiateStkPush = async (amount, phoneNumber, checkoutRequestId) => {
  const accessToken = await generateAccessToken();
  const { timestamp, password } = getStkCredentials();

  const payload = {
    BusinessShortCode: process.env.BUSINESS_SHORT_CODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phoneNumber,
    PartyB: process.env.BUSINESS_SHORT_CODE,
    PhoneNumber: phoneNumber,
    CallBackURL: `${process.env.BASE_URL}/api/mpesa/stk-callback`,
    AccountReference: 'POS Sale',
    TransactionDesc: 'Payment for goods',
  };

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  return data;
};