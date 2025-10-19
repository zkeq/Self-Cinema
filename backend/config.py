import yaml
from pathlib import Path

# 定义配置文件路径
CONFIG_FILE = Path(__file__).parent / 'config.yaml'

def load_config():
    """加载YAML配置文件"""
    if not CONFIG_FILE.exists():
        raise FileNotFoundError(f"Config file not found at {CONFIG_FILE}")
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)
    return config

# 加载配置
config = load_config()

# 提供便捷的配置访问
ADMIN_USERNAME = config.get('admin', {}).get('username', 'admin')
ADMIN_PASSWORD = config.get('admin', {}).get('password', 'your_strong_password')

JWT_SECRET_KEY = config.get('jwt', {}).get('secret_key', 'your-secret-key-here-change-in-production')
JWT_ALGORITHM = config.get('jwt', {}).get('algorithm', 'HS256')
JWT_EXPIRE_MINUTES = config.get('jwt', {}).get('expire_minutes', 30)