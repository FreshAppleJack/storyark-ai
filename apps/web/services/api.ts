import axios from 'axios';

const apiClient = axios.create({
    baseURL: 'http://localhost:8080/api',
    timeout: 10000,
    // Ask Axios to send cookies (for session authentication)
    withCredentials: true,
});

// request interceptor
apiClient.interceptors.request.use(
    (config) => {
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// response interceptor
apiClient.interceptors.response.use(
    response => response.data,
    (error) => {
        // handling 401 error
        if (error.response?.status === 401) {
            // Session expired, redirect to login page
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);
export default apiClient;