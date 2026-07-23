import axios from 'axios';

const API_BASE_URL = 'http://localhost:8001';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Added projectId parameter and payload
export const ingestRepository = async (url, ownerId, projectId) => {
  const response = await apiClient.post('/api/ingest', {
    url,
    owner_id: ownerId,
    project_id: projectId, // <--- New field required by FastAPI
  });
  return response.data;
};

// Added projectId parameter and payload
export const queryGraph = async (question, ownerId, projectId) => {
  const response = await apiClient.post('/api/query', {
    question,
    owner_id: ownerId,
    project_id: projectId, // <--- New field required by FastAPI
  });
  return response.data;
};

export const getIngestionStatus = async () => {
  const response = await apiClient.get('/api/ingest/status');
  return response.data;
};

export const checkHealth = async () => {
  const response = await apiClient.get('/api/health');
  return response.data;
};

export default apiClient;