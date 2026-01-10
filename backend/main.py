from fastapi import FastAPI, Depends, HTTPException, status, Request, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Deque, Dict, List, Optional
from pydantic import BaseModel
from urllib.parse import urlparse
import hashlib
import uuid
import re
import httpx

from models import get_db, create_tables, init_default_admin, Admin, Series, Episode, ShareLink
from auth import authenticate_admin, create_access_token, verify_token
from config import JWT_EXPIRE_MINUTES

# 创建FastAPI应用
app = FastAPI(title="Self Cinema API", version="1.0.0")

# 资源站点配置
API_SITES = {
    "ruyi": {
        "api": "https://cj.rycjapi.com/api.php/provide/vod",
        "name": "如意资源",
    },
    "bfzy": {
        "api": "https://bfzyapi.com/api.php/provide/vod",
        "name": "暴风资源",
    },
    "tyyszy": {
        "api": "https://tyyszy.com/api.php/provide/vod",
        "name": "天涯资源",
    },
    "ffzy": {
        "api": "http://ffzy5.tv/api.php/provide/vod",
        "name": "非凡影视",
        "detail": "http://ffzy5.tv",
    },
    "zy360": {
        "api": "https://360zy.com/api.php/provide/vod",
        "name": "360资源",
    },
    "wolong": {
        "api": "https://wolongzyw.com/api.php/provide/vod",
        "name": "卧龙资源",
    },
    "jisu": {
        "api": "https://jszyapi.com/api.php/provide/vod",
        "name": "极速资源",
        "detail": "https://jszyapi.com",
    },
    "mdzy": {
        "api": "https://www.mdzyapi.com/api.php/provide/vod",
        "name": "魔都资源",
    },
    "zuid": {
        "api": "https://api.zuidapi.com/api.php/provide/vod",
        "name": "最大资源",
    },
    "wujin": {
        "api": "https://api.wujinapi.me/api.php/provide/vod",
        "name": "无尽资源",
    },
    "wwzy": {
        "api": "https://wwzy.tv/api.php/provide/vod",
        "name": "旺旺短剧",
    },
    "ikun": {
        "api": "https://ikunzyapi.com/api.php/provide/vod",
        "name": "iKun资源",
    },
}

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

class ResourceSiteResponse(BaseModel):
    key: str
    name: str
    api: str
    detail: Optional[str] = None

class ResourceSearchItem(BaseModel):
    vod_id: int
    vod_name: str
    vod_sub: Optional[str] = None
    vod_pic: Optional[str] = None
    vod_remarks: Optional[str] = None
    vod_year: Optional[str] = None
    vod_actor: Optional[str] = None
    vod_director: Optional[str] = None
    type_name: Optional[str] = None

class ResourceSearchResponse(BaseModel):
    site: str
    page: int
    pagecount: int
    total: int
    list: List[ResourceSearchItem]

class ResourceImportRequest(BaseModel):
    site: str
    vod_id: int

class ResourceImportResponse(BaseModel):
    series: SeriesResponse
    episodes: List[EpisodeResponse]

class ResourcePreviewEpisode(BaseModel):
    episode: int
    title: str
    url: str

class ResourcePreviewResponse(BaseModel):
    site: str
    vod_id: int
    title: str
    cover: Optional[str] = None
    episodes: List[ResourcePreviewEpisode]

class WatchResponse(BaseModel):
    series: SeriesResponse
    episodes: List[EpisodeResponse]

class ChatMessage(BaseModel):
    id: str
    sender: str
    content: str
    timestamp: datetime
    type: Optional[str] = "chat"


class ChatMessageCreate(BaseModel):
    sender: Optional[str] = "匿名用户"
    content: str
    timestamp: Optional[datetime] = None
    type: Optional[str] = "chat"
    id: Optional[str] = None


class ChatRoomStore:
    """基于内存的轻量聊天室存储，便于轮询获取消息"""
    def __init__(self, max_messages: int = 200):
        self.rooms: Dict[str, Deque[ChatMessage]] = {}
        self.max_messages = max_messages

    def add_message(self, room: str, message: ChatMessage) -> ChatMessage:
        from collections import deque

        if room not in self.rooms:
            self.rooms[room] = deque(maxlen=self.max_messages)
        self.rooms[room].append(message)
        return message

    def get_messages(self, room: str, since: Optional[datetime] = None) -> List[ChatMessage]:
        if room not in self.rooms:
            return []
        messages = list(self.rooms[room])
        if since is None:
            return messages
        return [msg for msg in messages if msg.timestamp > since]


# 全局聊天室存储
chat_store = ChatRoomStore()

class PlaybackState(BaseModel):
    url: str
    updated_at: datetime
    version: int


class PlaybackUpdate(BaseModel):
    url: str


class PlaybackResponse(BaseModel):
    url: str
    updated_at: datetime
    version: int
    is_same_source: bool = True
    is_same_episode: bool = True


class PlaybackStore:
    """简单的房间播放状态存储，便于轮询同步"""
    def __init__(self):
        self.rooms: Dict[str, PlaybackState] = {}

    def update(self, room: str, url: str) -> PlaybackState:
        state = self.rooms.get(room)
        version = 1 if state is None else state.version + 1
        new_state = PlaybackState(url=url, updated_at=datetime.utcnow(), version=version)
        self.rooms[room] = new_state
        return new_state

    def get(self, room: str) -> Optional[PlaybackState]:
        return self.rooms.get(room)


playback_store = PlaybackStore()

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

def strip_html(content: Optional[str]) -> str:
    if not content:
        return ""
    return re.sub(r"<[^>]+>", "", content).strip()

def parse_year(text: Optional[str]) -> Optional[int]:
    if not text:
        return None
    match = re.search(r"(\d{4})", text)
    return int(match.group(1)) if match else None

def parse_list_field(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [item.strip() for item in re.split(r"[,\s]+", value) if item.strip()]

def parse_play_urls(play_url: Optional[str]) -> List[Dict[str, str]]:
    if not play_url:
        return []
    source_groups = play_url.split("$$$")
    first_group = source_groups[0]
    entries = [item for item in first_group.split("#") if item]
    results = []
    for index, entry in enumerate(entries, start=1):
        if "$" in entry:
            title, url = entry.split("$", 1)
            title = title.strip() or f"第{index}集"
        else:
            title, url = f"第{index}集", entry.strip()
        results.append({
            "episode": index,
            "title": title,
            "url": url.strip()
        })
    return results

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

async def fetch_resource_data(site_key: str, params: Dict[str, str]) -> Dict:
    site = API_SITES.get(site_key)
    if not site:
        raise HTTPException(status_code=400, detail="资源站点不存在")
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(site["api"], params=params)
        response.raise_for_status()
        return response.json()

@app.get("/resource-sites", response_model=List[ResourceSiteResponse])
async def get_resource_sites(admin: Admin = Depends(get_current_admin)):
    """获取资源站点列表"""
    return [
        ResourceSiteResponse(key=key, name=value["name"], api=value["api"], detail=value.get("detail"))
        for key, value in API_SITES.items()
    ]

@app.get("/resource-search", response_model=ResourceSearchResponse)
async def search_resource(
    site: str = Query(..., description="资源站点key"),
    keyword: str = Query(..., min_length=1, description="搜索关键词"),
    page: int = Query(1, ge=1),
    admin: Admin = Depends(get_current_admin)
):
    """搜索资源站点"""
    payload = await fetch_resource_data(site, {"ac": "videolist", "wd": keyword, "page": str(page)})
    items = [
        ResourceSearchItem(
            vod_id=item.get("vod_id"),
            vod_name=item.get("vod_name", ""),
            vod_sub=item.get("vod_sub"),
            vod_pic=item.get("vod_pic"),
            vod_remarks=item.get("vod_remarks"),
            vod_year=item.get("vod_year"),
            vod_actor=item.get("vod_actor"),
            vod_director=item.get("vod_director"),
            type_name=item.get("type_name")
        )
        for item in payload.get("list", [])
    ]
    return ResourceSearchResponse(
        site=site,
        page=payload.get("page", page),
        pagecount=payload.get("pagecount", 1),
        total=payload.get("total", len(items)),
        list=items
    )

@app.get("/resource-preview", response_model=ResourcePreviewResponse)
async def preview_resource(
    site: str = Query(..., description="资源站点key"),
    vod_id: int = Query(..., description="资源ID"),
    admin: Admin = Depends(get_current_admin)
):
    """预览资源站点资源播放信息"""
    payload = await fetch_resource_data(site, {"ac": "videolist", "ids": str(vod_id)})
    items = payload.get("list", [])
    if not items:
        raise HTTPException(status_code=404, detail="未找到资源详情")
    data = items[0]
    episodes_data = parse_play_urls(data.get("vod_play_url"))
    if not episodes_data:
        raise HTTPException(status_code=400, detail="资源暂无播放地址")
    return ResourcePreviewResponse(
        site=site,
        vod_id=vod_id,
        title=data.get("vod_name", ""),
        cover=data.get("vod_pic"),
        episodes=[
            ResourcePreviewEpisode(
                episode=episode["episode"],
                title=episode["title"],
                url=episode["url"]
            )
            for episode in episodes_data
        ]
    )

@app.post("/resource-import", response_model=ResourceImportResponse)
async def import_resource(request: ResourceImportRequest, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """导入资源站点资源"""
    payload = await fetch_resource_data(request.site, {"ac": "videolist", "ids": str(request.vod_id)})
    items = payload.get("list", [])
    if not items:
        raise HTTPException(status_code=404, detail="未找到资源详情")
    data = items[0]
    episodes_data = parse_play_urls(data.get("vod_play_url"))
    if not episodes_data:
        raise HTTPException(status_code=400, detail="资源暂无播放地址")

    series_id = str(uuid.uuid4())
    series = Series(
        id=series_id,
        title=data.get("vod_name", ""),
        english_title=data.get("vod_en"),
        description=strip_html(data.get("vod_blurb") or data.get("vod_content")),
        cover_image=data.get("vod_pic"),
        backdrop_image=data.get("vod_pic_slide") or data.get("vod_pic"),
        total_episodes=len(episodes_data),
        release_year=parse_year(data.get("vod_year")),
        rating=int(float(data.get("vod_douban_score") or data.get("vod_score") or 0) * 10),
        views=str(data.get("vod_hits") or "0"),
        status=data.get("vod_remarks") or ("已完结" if data.get("vod_isend") else "更新中"),
        director=data.get("vod_director"),
        region=data.get("vod_area"),
        language=data.get("vod_lang"),
        update_time=data.get("vod_time")
    )
    series.genre_list = parse_list_field(data.get("vod_class") or data.get("vod_tag"))
    series.actors_list = parse_list_field(data.get("vod_actor"))
    series.tags_list = parse_list_field(data.get("vod_tag"))

    db.add(series)
    db.flush()

    created_episodes = []
    for episode_info in episodes_data:
        episode = Episode(
            id=str(uuid.uuid4()),
            series_id=series_id,
            episode=episode_info["episode"],
            title=episode_info["title"],
            description=None,
            video_url=episode_info["url"],
            duration=data.get("vod_duration"),
            cover_image=data.get("vod_pic"),
            is_vip=False
        )
        db.add(episode)
        created_episodes.append(episode)

    db.commit()
    db.refresh(series)
    for episode in created_episodes:
        db.refresh(episode)

    return ResourceImportResponse(
        series=series_to_response(series),
        episodes=[episode_to_response(episode) for episode in created_episodes]
    )

# 分享功能API
@app.post("/series/{series_id}/share", response_model=ShareResponse)
async def create_share_link(series_id: str, request: Request, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    """生成分享链接"""
    series = db.query(Series).filter(Series.id == series_id).first()
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    existing_link = db.query(ShareLink).filter(ShareLink.series_id == series_id).order_by(ShareLink.created_at.desc()).first()
    if existing_link and (existing_link.expires_at is None or existing_link.expires_at > datetime.utcnow()):
        share_hash = existing_link.hash
    else:
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

@app.post("/together/{room_hash}/messages", response_model=ChatMessage)
async def post_chat_message(room_hash: str, payload: ChatMessageCreate):
    """通过HTTP提交聊天室消息，便于轮询"""
    if not payload.content:
        raise HTTPException(status_code=400, detail="Message content is required")

    message = ChatMessage(
        id=payload.id or str(uuid.uuid4()),
        sender=payload.sender or "匿名用户",
        content=payload.content,
        timestamp=payload.timestamp or datetime.utcnow(),
        type=payload.type or "chat",
    )
    return chat_store.add_message(room_hash, message)


@app.get("/together/{room_hash}/messages", response_model=List[ChatMessage])
async def get_chat_messages(room_hash: str, since: Optional[str] = Query(None)):
    """轮询获取聊天室消息，可通过 since 过滤"""
    since_dt = None
    if since:
        try:
            normalized = since.replace("Z", "+00:00")
            since_dt = datetime.fromisoformat(normalized)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid 'since' format, expected ISO8601")
    return chat_store.get_messages(room_hash, since_dt)

@app.post("/together/{room_hash}/playback", response_model=PlaybackResponse)
async def update_playback(room_hash: str, payload: PlaybackUpdate):
    """房主更新当前播放地址"""
    if not payload.url:
        raise HTTPException(status_code=400, detail="url is required")
    state = playback_store.update(room_hash, payload.url)
    return PlaybackResponse(**state.dict())


@app.get("/together/{room_hash}/playback", response_model=PlaybackResponse)
async def get_playback(
    room_hash: str,
    version: Optional[str] = Query(None),
    current_url: Optional[str] = Query(None, alias="currentUrl"),
    db: Session = Depends(get_db),
):
    """
    轮询获取当前房间的播放地址。
    如果传入 version，且与服务器一致，则仍会返回当前状态，客户端可自行比对是否变化。
    """
    if version not in (None, ""):
        try:
            int(version)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'version', expected integer or empty")

    state = playback_store.get(room_hash)
    if not state:
        raise HTTPException(status_code=404, detail="No playback state")

    is_same_source = True
    is_same_episode = True
    if current_url not in (None, ""):
        is_same_source = current_url == state.url
        if not is_same_source:
            host_episode = db.query(Episode).filter(Episode.video_url == state.url).first()
            viewer_episode = db.query(Episode).filter(Episode.video_url == current_url).first()
            if host_episode and viewer_episode:
                is_same_episode = (
                    host_episode.series_id == viewer_episode.series_id
                    and host_episode.episode == viewer_episode.episode
                )
            else:
                is_same_episode = False

    return PlaybackResponse(
        url=state.url,
        updated_at=state.updated_at,
        version=state.version,
        is_same_source=is_same_source,
        is_same_episode=is_same_episode,
    )

# 健康检查
@app.get("/")
async def health_check():
    return {"status": "ok", "message": "Self Cinema API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
