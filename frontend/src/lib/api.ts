import axios, { AxiosInstance } from 'axios';

// 完整的API数据结构定义
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface SeriesAPI {
  id: string;
  title: string;
  englishTitle?: string;
  description?: string;
  coverImage?: string;
  backdropImage?: string;
  totalEpisodes: number;
  releaseYear?: number;
  genre: string[];
  rating: number;
  views: string;
  status: string;
  director?: string;
  actors: string[];
  region?: string;
  language?: string;
  updateTime?: string;
  tags: string[];
  created_at: string;
}

export interface EpisodeAPI {
  id: string;
  series_id: string;
  episode: number;
  title: string;
  description?: string;
  videoUrl: string;
  duration?: string;
  cover_image?: string;
  isVip: boolean;
  created_at: string;
}

export interface CreateSeriesRequest {
  title: string;
  englishTitle?: string;
  description?: string;
  coverImage?: string;
  backdropImage?: string;
  totalEpisodes: number;
  releaseYear?: number;
  genre: string[];
  rating: number;
  views: string;
  status: string;
  director?: string;
  actors: string[];
  region?: string;
  language?: string;
  updateTime?: string;
  tags: string[];
}

export interface CreateEpisodeRequest {
  series_id: string;
  episode: number;
  title: string;
  description?: string;
  videoUrl: string;
  duration?: string;
  cover_image?: string;
  isVip: boolean;
}

export interface ShareResponse {
  shareUrl: string;
  hash: string;
  expiresAt?: string;
}

class ApiClient {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.api.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.api.interceptors.response.use(
        (response) => response,
        (error: { response: { status: number; }; }) => {
          if (error.response?.status === 401 && typeof window !== 'undefined') {
            localStorage.removeItem('token');
            window.location.href = '/admin/login';
          }
          return Promise.reject(error);
        },
    );
  }

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await this.api.post('/auth/login', credentials);
    return response.data;
  }

  async getSeries(): Promise<SeriesAPI[]> {
    const response = await this.api.get('/series');
    return response.data;
  }

  async getSeriesById(id: string): Promise<SeriesAPI> {
    const response = await this.api.get(`/series/${id}`);
    return response.data;
  }

  async createSeries(data: CreateSeriesRequest): Promise<SeriesAPI> {
    const response = await this.api.post('/series', data);
    return response.data;
  }

  async updateSeries(id: string, data: CreateSeriesRequest): Promise<SeriesAPI> {
    const response = await this.api.put(`/series/${id}`, data);
    return response.data;
  }

  async deleteSeries(id: string): Promise<void> {
    await this.api.delete(`/series/${id}`);
  }

  async getEpisodes(seriesId: string): Promise<EpisodeAPI[]> {
    const response = await this.api.get(`/series/${seriesId}/episodes`);
    return response.data;
  }

  async getEpisodeById(id: string): Promise<EpisodeAPI> {
    const response = await this.api.get(`/episodes/${id}`);
    return response.data;
  }

  async createEpisode(data: CreateEpisodeRequest): Promise<EpisodeAPI> {
    const response = await this.api.post('/episodes', data);
    return response.data;
  }

  async updateEpisode(id: string, data: CreateEpisodeRequest): Promise<EpisodeAPI> {
    const response = await this.api.put(`/episodes/${id}`, data);
    return response.data;
  }

  async deleteEpisode(id: string): Promise<void> {
    await this.api.delete(`/episodes/${id}`);
  }

  async createShareLink(seriesId: string): Promise<ShareResponse> {
    const response = await this.api.post(`/series/${seriesId}/share`);
    return response.data;
  }

  async getWatchData(hash: string): Promise<{series: SeriesAPI, episodes: EpisodeAPI[]}> {
    const response = await this.api.get(`/watch/${hash}`);
    return response.data;
  }
}

export const apiClient = new ApiClient();
