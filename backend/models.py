from sqlalchemy import create_engine, Column, String, Integer, Text, Boolean, DateTime, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from datetime import datetime
import json

# 数据库配置
SQLITE_DATABASE_URL = "sqlite:///./database.db"
engine = create_engine(SQLITE_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# 数据库依赖
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# 管理员模型
class Admin(Base):
    __tablename__ = "admins"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

# 电视剧模型
class Series(Base):
    __tablename__ = "series"
    
    id = Column(String(50), primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    english_title = Column(String(200))
    description = Column(Text)
    cover_image = Column(String(500))
    backdrop_image = Column(String(500))
    total_episodes = Column(Integer, default=0)
    release_year = Column(Integer)
    genre = Column(Text)  # JSON string
    rating = Column(Integer, default=0)  # 0-100 for precision
    views = Column(String(50))
    status = Column(String(50))
    director = Column(String(200))
    actors = Column(Text)  # JSON string
    region = Column(String(100))
    language = Column(String(100))
    update_time = Column(String(200))
    tags = Column(Text)  # JSON string
    created_at = Column(DateTime, default=datetime.utcnow)
    
    @property
    def genre_list(self):
        return json.loads(self.genre) if self.genre else []
    
    @genre_list.setter
    def genre_list(self, value):
        self.genre = json.dumps(value) if value else "[]"
    
    @property
    def actors_list(self):
        return json.loads(self.actors) if self.actors else []
    
    @actors_list.setter
    def actors_list(self, value):
        self.actors = json.dumps(value) if value else "[]"
    
    @property
    def tags_list(self):
        return json.loads(self.tags) if self.tags else []
    
    @tags_list.setter
    def tags_list(self, value):
        self.tags = json.dumps(value) if value else "[]"

# 剧集模型
class Episode(Base):
    __tablename__ = "episodes"
    
    id = Column(String(50), primary_key=True, index=True)
    series_id = Column(String(50), nullable=False, index=True)
    episode = Column(Integer, nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text)
    video_url = Column(String(500), nullable=False)
    duration = Column(String(20))
    cover_image = Column(String(500))
    is_vip = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

# 分享链接模型
class ShareLink(Base):
    __tablename__ = "share_links"
    
    id = Column(Integer, primary_key=True, index=True)
    hash = Column(String(100), unique=True, index=True, nullable=False)
    series_id = Column(String(50), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

# 创建所有表
def create_tables():
    Base.metadata.create_all(bind=engine)

# 初始化默认管理员账号
def init_default_admin():
    from auth import get_password_hash, verify_password
    from config import ADMIN_USERNAME, ADMIN_PASSWORD
    
    db = SessionLocal()
    try:
        # 从配置文件获取管理员信息
        config_username = ADMIN_USERNAME
        config_password = ADMIN_PASSWORD

        # 检查数据库中是否已存在管理员
        admin = db.query(Admin).first()

        if admin:
            # 如果存在，检查用户名和密码是否与配置一致
            if admin.username != config_username or not verify_password(config_password, admin.password_hash):
                # 如果不一致，删除旧的管理员
                db.delete(admin)
                db.commit()
                print(f"Removed old admin account: {admin.username}")
                # 重新创建
                new_admin = Admin(
                    username=config_username,
                    password_hash=get_password_hash(config_password)
                )
                db.add(new_admin)
                db.commit()
                print(f"Created new admin account from config: {config_username}")
        else:
            # 如果不存在，直接创建新管理员
            new_admin = Admin(
                username=config_username,
                password_hash=get_password_hash(config_password)
            )
            db.add(new_admin)
            db.commit()
            print(f"Created initial admin account from config: {config_username}")
            
    finally:
        db.close()