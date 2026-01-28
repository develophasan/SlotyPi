const axios = require('axios');

const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_URL = process.env.PI_API_URL || 'https://api.minepi.com/v2';
const PI_SANDBOX_API_URL = process.env.PI_SANDBOX_API_URL || 'https://api.sandbox.minepi.com/v2';

// Determine which API URL to use based on environment
const getApiUrl = () => {
  return process.env.NODE_ENV === 'production' ? PI_API_URL : PI_SANDBOX_API_URL;
};

const getHeaders = () => {
  return {
    'Authorization': `Key ${PI_API_KEY}`,
    'Content-Type': 'application/json'
  };
};

/**
 * Verify user access token with Pi Platform API
 */
const verifyUser = async (accessToken) => {
  try {
    const response = await axios.get(`${getApiUrl()}/me`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return {
      success: true,
      user: response.data
    };
  } catch (error) {
    if (error.response?.status === 401) {
      return {
        success: false,
        error: 'Invalid access token'
      };
    }
    throw error;
  }
};

/**
 * Approve a payment (Server-Side Approval)
 */
const approvePayment = async (paymentId) => {
  try {
    const response = await axios.post(
      `${getApiUrl()}/payments/${paymentId}/approve`,
      {},
      { headers: getHeaders() }
    );
    return {
      success: true,
      payment: response.data
    };
  } catch (error) {
    console.error('Error approving payment:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
};

/**
 * Complete a payment (Server-Side Completion)
 */
const completePayment = async (paymentId, txid) => {
  try {
    const response = await axios.post(
      `${getApiUrl()}/payments/${paymentId}/complete`,
      { txid },
      { headers: getHeaders() }
    );
    return {
      success: true,
      payment: response.data
    };
  } catch (error) {
    console.error('Error completing payment:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
};

/**
 * Get payment details
 */
const getPayment = async (paymentId) => {
  try {
    const response = await axios.get(
      `${getApiUrl()}/payments/${paymentId}`,
      { headers: getHeaders() }
    );
    return {
      success: true,
      payment: response.data
    };
  } catch (error) {
    console.error('Error getting payment:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
};

/**
 * Cancel a payment
 */
const cancelPayment = async (paymentId) => {
  try {
    const response = await axios.post(
      `${getApiUrl()}/payments/${paymentId}/cancel`,
      {},
      { headers: getHeaders() }
    );
    return {
      success: true,
      payment: response.data
    };
  } catch (error) {
    console.error('Error cancelling payment:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
};

module.exports = {
  verifyUser,
  approvePayment,
  completePayment,
  getPayment,
  cancelPayment
};

