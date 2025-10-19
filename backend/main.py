from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel
from urllib.parse import urlparse
import hashlib
import uuid
import json

from models import get_db, create_tables, init_default_admin, Admin, Series, Episode, ShareLink
from auth import authenticate_admin, create_access_token, verify_token
from config import JWT_EXPIRE_MINUTES

# 创建FastAPI应用
app = FastAPI(title="Self Cinema API", version="1.0.0")

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 安全配置
security = HTTPBearer()

# Pydantic模型
class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str

class SeriesCreate(BaseModel):
    title: str
    englishTitle: Optional[str] = None
    description: Optional[str] = None
    coverImage: Optional[str] = None
    backdropImage: Optional[str] = None
    totalEpisodes: int = 0
    releaseYear: Optional[int] = None
    genre: List[str] = []
    rating: float = 0.0
    views: str = "0"
    status: str = "待播出"
    director: Optional[str] = None
    actors: List[str] = []
    region: Optional[str] = None
    language: Optional[str] = None
    updateTime: Optional[str] = None
    tags: List[str] = []

class SeriesResponse(BaseModel):
    id: str
    title: str
    englishTitle: Optional[str]
    description: Optional[str]
    coverImage: Optional[str]
    backdropImage: Optional[str]
    totalEpisodes: int
    releaseYear: Optional[int]
    genre: List[str]
    rating: float
    views: str
    status: str
    director: Optional[str]
    actors: List[str]
    region: Optional[str]
    language: Optional[str]
    updateTime: Optional[str]
    tags: List[str]
    created_at: datetime

class EpisodeCreate(BaseModel):
    series_id: str
    episode: int
    title: str
    description: Optional[str] = None
    videoUrl: str
    duration: Optional[str] = None
    cover_image: Optional[str] = None
    isVip: bool = False

class EpisodeResponse(BaseModel):
    id: str
    series_id: str
    episode: int
    title: str
    description: Optional[str]
    videoUrl: str
    duration: Optional[str]
    cover_image: Optional[str]
    isVip: bool
    created_at: datetime

class ShareResponse(BaseModel):
    shareUrl: str
    hash: str
    expiresAt: Optional[datetime]

class WatchResponse(BaseModel):
    series: SeriesResponse
    episodes: List[EpisodeResponse]

# 依赖函数
def get_current_admin(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)):
    """获取当前管理员"""
    username = verify_token(credentials.credentials)
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    admin = db.query(Admin).filter(Admin.username == username).first()
    if admin is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return admin

# 辅助函数
def series_to_response(series: Series) -> SeriesResponse:
    """转换Series模型到响应模型"""
    return SeriesResponse(
        id=series.id,
        title=series.title,
        englishTitle=series.english_title,
        description=series.description,
        coverImage=series.cover_image,
        backdropImage=series.backdrop_image,
        totalEpisodes=series.total_episodes,
        releaseYear=series.release_year,
        genre=series.genre_list,
        rating=series.rating / 10.0 if series.rating else 0.0,
        views=series.views or "0",
        status=series.status or "待播出",
        director=series.director,
        actors=series.actors_list,
        region=series.region,
        language=series.language,
        updateTime=series.update_time,
        tags=series.tags_list,
        created_at=series.created_at
    )

def episode_to_response(episode: Episode) -> EpisodeResponse:
    """转换Episode模型到响应模型"""
    return EpisodeResponse(
        id=episode.id,
        series_id=episode.series_id,
        episode=episode.episode,
        title=episode.title,
        description=episode.description,
        videoUrl=episode.video_url,
        duration=episode.duration,
        cover_image=episode.cover_image,
        isVip=episode.is_vip,
        created_at=episode.created_at
    )

# API路由

# 启动事件
@app.on_event("startup")
async def startup_event():
    create_tables()
    init_default_admin()

# 认证相关
@app.post("/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """管理员登录"""
    admin = authenticate_admin(db, request.username, request.password)
    if not admin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=JWT_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": admin.username}, expires_delta=access_token_expires
    )
    return LoginResponse(access_token=access_token, token_type="Bearer")

# 电视剧相关API
@app.get("/series", response_model=List[SeriesResponse])
async def get_series(db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """获取所有电视剧"""
    series_list = db.query(Series).all()
    return [series_to_response(series) for series in series_list]

@app.get("/series/{series_id}", response_model=SeriesResponse)
async def get_series_by_id(series_id: str, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """获取单个电视剧详情"""
    series = db.query(Series).filter(Series.id == series_id).first()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return series_to_response(series)

@app.post("/series", response_model=SeriesResponse)
async def create_series(request: SeriesCreate, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """创建电视剧"""
    series_id = str(uuid.uuid4())
    series = Series(
        id=series_id,
        title=request.title,
        english_title=request.englishTitle,
        description=request.description,
        cover_image=request.coverImage,
        backdrop_image=request.backdropImage,
        total_episodes=request.totalEpisodes,
        release_year=request.releaseYear,
        rating=int(request.rating * 10),  # 存储为整数
        views=request.views,
        status=request.status,
        director=request.director,
        region=request.region,
        language=request.language,
        update_time=request.updateTime
    )
    series.genre_list = request.genre
    series.actors_list = request.actors
    series.tags_list = request.tags
    
    db.add(series)
    db.commit()
    db.refresh(series)
    return series_to_response(series)

@app.put("/series/{series_id}", response_model=SeriesResponse)
async def update_series(series_id: str, request: SeriesCreate, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """更新电视剧"""
    series = db.query(Series).filter(Series.id == series_id).first()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    
    series.title = request.title
    series.english_title = request.englishTitle
    series.description = request.description
    series.cover_image = request.coverImage
    series.backdrop_image = request.backdropImage
    series.total_episodes = request.totalEpisodes
    series.release_year = request.releaseYear
    series.rating = int(request.rating * 10)
    series.views = request.views
    series.status = request.status
    series.director = request.director
    series.region = request.region
    series.language = request.language
    series.update_time = request.updateTime
    series.genre_list = request.genre
    series.actors_list = request.actors
    series.tags_list = request.tags
    
    db.commit()
    return series_to_response(series)

@app.delete("/series/{series_id}")
async def delete_series(series_id: str, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """删除电视剧"""
    series = db.query(Series).filter(Series.id == series_id).first()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    
    # 删除相关剧集
    db.query(Episode).filter(Episode.series_id == series_id).delete()
    # 删除相关分享链接
    db.query(ShareLink).filter(ShareLink.series_id == series_id).delete()
    # 删除电视剧
    db.delete(series)
    db.commit()
    return {"message": "删除成功"}

# 剧集相关API
@app.get("/series/{series_id}/episodes", response_model=List[EpisodeResponse])
async def get_episodes(series_id: str, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """获取电视剧的所有剧集"""
    episodes = db.query(Episode).filter(Episode.series_id == series_id).order_by(Episode.episode).all()
    return [episode_to_response(episode) for episode in episodes]

@app.get("/episodes/{episode_id}", response_model=EpisodeResponse)
async def get_episode_by_id(episode_id: str, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """获取单个剧集详情"""
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")
    return episode_to_response(episode)

@app.post("/episodes", response_model=EpisodeResponse)
async def create_episode(request: EpisodeCreate, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """创建剧集"""
    # 检查电视剧是否存在
    series = db.query(Series).filter(Series.id == request.series_id).first()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    
    episode_id = str(uuid.uuid4())
    episode = Episode(
        id=episode_id,
        series_id=request.series_id,
        episode=request.episode,
        title=request.title,
        description=request.description,
        video_url=request.videoUrl,
        duration=request.duration,
        cover_image=request.cover_image,
        is_vip=request.isVip
    )
    
    db.add(episode)
    db.commit()
    db.refresh(episode)
    return episode_to_response(episode)

@app.put("/episodes/{episode_id}", response_model=EpisodeResponse)
async def update_episode(episode_id: str, request: EpisodeCreate, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """更新剧集"""
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")
    
    episode.series_id = request.series_id
    episode.episode = request.episode
    episode.title = request.title
    episode.description = request.description
    episode.video_url = request.videoUrl
    episode.duration = request.duration
    episode.cover_image = request.cover_image
    episode.is_vip = request.isVip
    
    db.commit()
    return episode_to_response(episode)

@app.delete("/episodes/{episode_id}")
async def delete_episode(episode_id: str, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """删除剧集"""
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")
    
    db.delete(episode)
    db.commit()
    return {"message": "删除成功"}

# 分享功能API
@app.post("/series/{series_id}/share", response_model=ShareResponse)
async def create_share_link(series_id: str, request: Request, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """生成分享链接"""
    series = db.query(Series).filter(Series.id == series_id).first()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    # 生成唯一hash
    hash_source = f"{series_id}{datetime.utcnow().isoformat()}"
    share_hash = hashlib.md5(hash_source.encode()).hexdigest()[:16]

    # 创建分享链接记录
    share_link = ShareLink(
        hash=share_hash,
        series_id=series_id,
        expires_at=None  # 永不过期
    )

    db.add(share_link)
    db.commit()

    # 动态获取请求来源地址
    # 优先使用 Referer，其次使用 Origin，最后使用 Host
    base_url = None

    # 尝试从 Referer 获取
    referer = request.headers.get("referer")
    if referer:
        # 从 referer 中提取协议和域名
        parsed = urlparse(referer)
        base_url = f"{parsed.scheme}://{parsed.netloc}"

    # 如果没有 Referer，尝试从 Origin 获取
    if not base_url:
        origin = request.headers.get("origin")
        if origin:
            base_url = origin

    # 如果都没有，使用 Host 构建 URL
    if not base_url:
        host = request.headers.get("host", "localhost:3000")
        # 判断是否为 HTTPS（通过 X-Forwarded-Proto 或其他代理头）
        scheme = "https" if request.headers.get("x-forwarded-proto") == "https" else "http"
        base_url = f"{scheme}://{host}"

    return ShareResponse(
        shareUrl=f"{base_url}/watch/{share_hash}",
        hash=share_hash,
        expiresAt=None
    )

@app.get("/watch/{hash}", response_model=WatchResponse)
async def get_watch_data(hash: str, db: Session = Depends(get_db)):
    """通过分享链接获取剧集信息"""
    share_link = db.query(ShareLink).filter(ShareLink.hash == hash).first()
    if not share_link:
        raise HTTPException(status_code=404, detail="Share link not found")
    
    # 检查是否过期
    if share_link.expires_at and share_link.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Share link expired")
    
    # 获取电视剧和剧集信息
    series = db.query(Series).filter(Series.id == share_link.series_id).first()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    
    episodes = db.query(Episode).filter(Episode.series_id == series.id).order_by(Episode.episode).all()
    
    return WatchResponse(
        series=series_to_response(series),
        episodes=[episode_to_response(episode) for episode in episodes]
    )

# 健康检查
@app.get("/")
async def health_check():
    return {"status": "ok", "message": "Self Cinema API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)