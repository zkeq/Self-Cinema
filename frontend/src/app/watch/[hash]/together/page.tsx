"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { VideoPlayer } from "@/components/video-player";
import { apiClient, EpisodeAPI, SeriesAPI } from "@/lib/api";
import {
  ArrowLeft,
  Copy,
  Link2,
  Loader2,
  MessageCircle,
  MonitorPlay,
  Send,
  Share2,
  ShieldCheck,
  Users,
} from "lucide-react";

type ChatMessage = {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
  type?: "chat" | "system" | "presence";
};

declare global {
  interface Window {
    videoTogetherExtension?: {
      CreateRoom: (name: string, password?: string) => void;
      JoinRoom: (name: string, password?: string) => void;
      roomName?: string;
    };
  }
}

export default function TogetherPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const hash = params.hash as string;

  const initialEpisode = parseInt(searchParams.get("episode") || "1", 10);
  const initialRoom = searchParams.get("room") || `movie-${hash}`;
  const initialPassword = searchParams.get("password") || `pass-${hash}`;
  const initialAction =
    (searchParams.get("action") as "create" | "join" | null) || "join";

  const [series, setSeries] = useState<SeriesAPI | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeAPI[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState(initialEpisode);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [roomName, setRoomName] = useState(initialRoom);
  const [roomPassword] = useState(initialPassword);
  const [roomAction, setRoomAction] = useState<"create" | "join">(
    initialAction === "create" ? "create" : "join",
  );
  const [vtScriptLoaded, setVtScriptLoaded] = useState(false);
  const [vtReady, setVtReady] = useState(false);
  const [vtStatus, setVtStatus] = useState<string>("插件未加载");
  const [isHost, setIsHost] = useState(initialAction === "create");
  const isJoinLink = initialAction === "join";
  const roomInitializedRef = useRef(false);
  const settingsAppliedRef = useRef(false);

  const [displayName, setDisplayName] = useState(
    `影迷${Math.floor(Math.random() * 900 + 100)}`,
  );
  const [messageInput, setMessageInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [chatStatus, setChatStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatSinceRef = useRef<string | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const playbackPollRef = useRef<NodeJS.Timeout | null>(null);
  const [playbackVersion, setPlaybackVersion] = useState<number>(0);
  const [overrideSrc, setOverrideSrc] = useState<string | null>(null);
  const messageIdsRef = useRef<Set<string>>(new Set());
  const onlineUsersRef = useRef<Map<string, number>>(new Map());
  const isSendingRef = useRef(false);
  const previousDisplayNameRef = useRef(displayName);

  const ONLINE_WINDOW_MS = 45_000;
  const HEARTBEAT_INTERVAL_MS = 20_000;

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const shareLink = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const url = new URL(
      `${window.location.origin}/watch/${hash}/together`,
    );
    url.searchParams.set("action", "join");
    url.searchParams.set("room", roomName);
    url.searchParams.set("password", roomPassword);
    url.searchParams.set("episode", currentEpisode.toString());
    return url.toString();
  }, [currentEpisode, hash, roomName, roomPassword]);

  const currentEpisodeData = episodes.find(
    (item) => item.episode === currentEpisode,
  );

  const generateId = useCallback(
    () =>
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}`,
    [],
  );

  const addSystemMessage = useCallback(
    (text: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          sender: "系统",
          content: text,
          timestamp: new Date().toISOString(),
          type: "system",
        },
      ]);
    },
    [generateId],
  );

  const updateOnlineUser = useCallback((name: string, timestamp: string) => {
    if (!name) return;
    const ts = new Date(timestamp).getTime();
    if (Number.isNaN(ts)) return;
    onlineUsersRef.current.set(name, ts);
  }, []);

  const syncOnlineUsers = useCallback(() => {
    const now = Date.now();
    const activeEntries = Array.from(onlineUsersRef.current.entries()).filter(
      ([, ts]) => now - ts <= ONLINE_WINDOW_MS,
    );
    onlineUsersRef.current = new Map(activeEntries);
    const active = activeEntries.map(([name]) => name);
    setOnlineUsers(active);
  }, []);

  const applyMinimizeDefault = useCallback(() => {
    if (typeof window === "undefined") return;
    const postSetting = (key: string, value: unknown) => {
      window.postMessage(
        {
          type: 15,
          source: "VideoTogether",
          data: { key, value },
        },
        "*",
      );
    };

    postSetting("MinimiseDefault", true);
    postSetting("DisableRedirectJoin", true);
    settingsAppliedRef.current = true;
  }, []);

  const handleCreateRoom = useCallback(() => {
    if (!window.videoTogetherExtension) {
      setVtStatus("插件还未初始化完成");
      return;
    }
    window.videoTogetherExtension.CreateRoom(roomName, roomPassword);
    setIsHost(true);
    setVtStatus("已创建房间并成为房主");
    roomInitializedRef.current = true;
    applyMinimizeDefault();
  }, [applyMinimizeDefault, roomName, roomPassword]);

  const handleJoinRoom = useCallback(() => {
    if (!window.videoTogetherExtension) {
      setVtStatus("插件还未初始化完成");
      return;
    }
    window.videoTogetherExtension.JoinRoom(roomName, roomPassword);
    setIsHost(false);
    setVtStatus("已加入房间");
    roomInitializedRef.current = true;
    applyMinimizeDefault();
  }, [applyMinimizeDefault, roomName, roomPassword]);

  const handleEpisodeChange = useCallback((episodeNumber: number) => {
    setCurrentEpisode(episodeNumber);
    if (typeof window !== "undefined") {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("episode", episodeNumber.toString());
      window.history.replaceState({}, "", nextUrl.toString());
    }
  }, []);

  const syncRoomVideo = useCallback(
    async (videoUrl: string) => {
      if (!window.videoTogetherExtension || !roomName || !videoUrl) {
        return;
      }

      // 1) 通知 VideoTogether
      if (isHost) {
        const vt = window.videoTogetherExtension as unknown as {
          UpdateRoom?: (
            name: string,
            password: string,
            url: string,
            playbackRate: number,
            currentTime: number,
            paused: boolean,
            duration: number,
            localTimestamp: number,
            m3u8Url?: string,
          ) => void;
          getLocalTimestamp?: () => number;
        };
        const localTs = vt.getLocalTimestamp?.() ?? Date.now() / 1000;
        vt.UpdateRoom?.(
          roomName,
          roomPassword,
          videoUrl,
          1,
          0,
          true,
          0,
          localTs,
          "",
        );
      }

      // 2) 通知后台轮询接口
      try {
        await fetch(`${apiBaseUrl}/together/${hash}/playback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: videoUrl }),
        });
      } catch (err) {
        console.error("同步房间播放地址失败", err);
      }
    },
    [apiBaseUrl, hash, isHost, roomName, roomPassword],
  );

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      addSystemMessage("分享链接已复制");
    } catch {
      addSystemMessage("复制失败，请手动复制链接");
    }
  };

  const fetchMessages = useCallback(async () => {
    try {
      const since = chatSinceRef.current
        ? `?since=${encodeURIComponent(chatSinceRef.current)}`
        : "";
      const res = await fetch(
        `${apiBaseUrl}/together/${hash}/messages${since}`,
      );
      if (!res.ok) {
        throw new Error("获取消息失败");
      }
      const data: ChatMessage[] = await res.json();
      const newMessages = data.filter((msg) => {
        if (messageIdsRef.current.has(msg.id)) return false;
        messageIdsRef.current.add(msg.id);
        updateOnlineUser(msg.sender, msg.timestamp);
        return true;
      });
      if (data.length > 0) {
        const last = data[data.length - 1];
        chatSinceRef.current = last.timestamp;
      }
      const chatMessages = newMessages.filter(
        (message) => message.type !== "presence",
      );
      if (chatMessages.length > 0) {
        setMessages((prev) => [...prev, ...chatMessages]);
      }
      syncOnlineUsers();
      setChatStatus("connected");
    } catch (err) {
      console.error(err);
      setChatStatus("disconnected");
    }
  }, [apiBaseUrl, hash, syncOnlineUsers, updateOnlineUser]);

  const startPolling = useCallback(() => {
    setChatStatus("connecting");
    fetchMessages();
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    pollTimerRef.current = setInterval(fetchMessages, 2500);
  }, [fetchMessages]);

  const sendMessage = async () => {
    if (!messageInput.trim() || isSendingRef.current) return;
    isSendingRef.current = true;

    const payload: ChatMessage = {
      id: generateId(),
      sender: displayName,
      content: messageInput.trim(),
      timestamp: new Date().toISOString(),
      type: "chat",
    };

    try {
      const res = await fetch(`${apiBaseUrl}/together/${hash}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error("发送失败");
      }
      messageIdsRef.current.add(payload.id);
      updateOnlineUser(payload.sender, payload.timestamp);
      setMessages((prev) => [...prev, payload]);
      chatSinceRef.current = payload.timestamp;
      syncOnlineUsers();
      setChatStatus("connected");
      setMessageInput("");
    } catch (err) {
      console.error(err);
      setChatStatus("disconnected");
    } finally {
      isSendingRef.current = false;
    }
  };

  const sendPresenceHeartbeat = useCallback(async () => {
    const payload: ChatMessage = {
      id: generateId(),
      sender: displayName,
      content: "heartbeat",
      timestamp: new Date().toISOString(),
      type: "presence",
    };
    try {
      const res = await fetch(`${apiBaseUrl}/together/${hash}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error("心跳发送失败");
      }
      messageIdsRef.current.add(payload.id);
      updateOnlineUser(payload.sender, payload.timestamp);
      syncOnlineUsers();
    } catch (err) {
      console.error(err);
    }
  }, [apiBaseUrl, displayName, generateId, hash, syncOnlineUsers, updateOnlineUser]);

  // 加载播放数据
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        const data = await apiClient.getWatchData(hash);
        setSeries(data.series);
        setEpisodes(data.episodes);
      } catch (err) {
        console.error("Failed to load watch data:", err);
        setError("加载失败，请检查分享链接是否有效");
      } finally {
        setIsLoading(false);
      }
    };
    if (hash) {
      loadData();
    }
  }, [hash]);

  // 聊天室轮询
  useEffect(() => {
    startPolling();
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [startPolling]);

  useEffect(() => {
    sendPresenceHeartbeat();
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
    }
    heartbeatRef.current = setInterval(() => {
      sendPresenceHeartbeat();
      syncOnlineUsers();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, [sendPresenceHeartbeat, syncOnlineUsers]);

  useEffect(() => {
    const prev = previousDisplayNameRef.current;
    if (prev && prev !== displayName) {
      const ts = onlineUsersRef.current.get(prev);
      if (ts) {
        onlineUsersRef.current.delete(prev);
        onlineUsersRef.current.set(displayName, ts);
        syncOnlineUsers();
      }
    }
    previousDisplayNameRef.current = displayName;
  }, [displayName, syncOnlineUsers]);

  // 房主切换剧集后同步 URL 给房间成员
  useEffect(() => {
    if (!currentEpisodeData?.videoUrl) return;
    // 延迟一点点，确保播放器源更新后再通知房间
    const timer = setTimeout(() => syncRoomVideo(currentEpisodeData.videoUrl), 300);
    return () => clearTimeout(timer);
  }, [currentEpisodeData, syncRoomVideo]);

  // 轮询后台播放地址，跟随房主的切换
  const fetchPlayback = useCallback(async () => {
    try {
      const currentPlaybackUrl =
        overrideSrc || currentEpisodeData?.videoUrl || "";
      const res = await fetch(
        `${apiBaseUrl}/together/${hash}/playback?version=${playbackVersion || ""}&currentUrl=${encodeURIComponent(currentPlaybackUrl)}`,
      );
      if (!res.ok) return;
      const data: {
        url: string;
        version: number;
        is_same_source?: boolean;
        is_same_episode?: boolean;
      } = await res.json();
      if (!data?.url) return;
      if (data.version === playbackVersion) return;
      setPlaybackVersion(data.version);
      if (data.is_same_source === false || data.is_same_episode === false) {
        addSystemMessage("已为你同步到房主的播放进度");
      }

      // 如果存在匹配的剧集，则同步选集中状态，否则仅覆盖播放源
      const matchedEpisode = episodes.find((ep) => ep.videoUrl === data.url);
      if (matchedEpisode) {
        setOverrideSrc(null);
        handleEpisodeChange(matchedEpisode.episode);
      } else {
        setOverrideSrc(data.url);
      }
    } catch (err) {
      console.error("轮询播放地址失败", err);
    }
  }, [
    addSystemMessage,
    apiBaseUrl,
    currentEpisodeData?.videoUrl,
    episodes,
    handleEpisodeChange,
    hash,
    overrideSrc,
    playbackVersion,
  ]);

  useEffect(() => {
    if (isHost) return; // 房主自己触发更新
    fetchPlayback();
    if (playbackPollRef.current) {
      clearInterval(playbackPollRef.current);
    }
    playbackPollRef.current = setInterval(fetchPlayback, 2500);
    return () => {
      if (playbackPollRef.current) {
        clearInterval(playbackPollRef.current);
      }
    };
  }, [fetchPlayback, isHost]);

  // 自动滚动到底部
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 本地存储昵称
  useEffect(() => {
    const storedName = localStorage.getItem("together-display-name");
    if (storedName) {
      setDisplayName(storedName);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("together-display-name", displayName);
  }, [displayName]);

  useEffect(() => {
    applyMinimizeDefault();
  }, [applyMinimizeDefault]);

  // 注入 VideoTogether 脚本
  useEffect(() => {
    const existing = document.getElementById("video-together-loader");
    if (existing) {
      setVtScriptLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.id = "video-together-loader";
    script.src = "/extension.website.user.js";
    script.async = true;
    script.onload = () => setVtScriptLoaded(true);
    script.onerror = () => setVtStatus("一起看脚本加载失败，请刷新重试");
    document.body.appendChild(script);
  }, []);

  // 轮询等待插件就绪
  useEffect(() => {
    if (!vtScriptLoaded) return;
    const timer = setInterval(() => {
      if (window.videoTogetherExtension) {
        setVtReady(true);
        setVtStatus("VideoTogether 插件已就绪");
        if (!settingsAppliedRef.current) {
          applyMinimizeDefault();
        }
        // 保持轮询以便在脚本意外恢复时再次应用设置
      }
    }, 400);
    return () => clearInterval(timer);
  }, [applyMinimizeDefault, vtScriptLoaded]);

  // 脚本就绪后自动创建/加入房间
  useEffect(() => {
    if (!vtReady || roomInitializedRef.current) return;
    if (roomAction === "create") {
      handleCreateRoom();
    } else {
      handleJoinRoom();
    }
  }, [handleCreateRoom, handleJoinRoom, roomAction, vtReady]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  if (error || !series) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">加载失败</p>
          <p className="text-muted-foreground">{error}</p>
          <Button onClick={() => window.location.reload()}>刷新页面</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur border-b border-border/50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/watch/${hash}`}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                返回详情
              </Button>
            </Link>
            <div>
              <h1 className="font-semibold text-sm leading-tight">{series.title}</h1>
              <p className="text-xs text-muted-foreground">
                一起看房间 · {roomName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={vtReady ? "secondary" : "outline"}>
              {vtStatus}
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4 order-1">
            <Card className="overflow-hidden">
              <CardHeader className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <MonitorPlay className="h-5 w-5 text-primary" />
                    正在播放 · 第 {currentEpisode} 集
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {!isJoinLink && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => {
                          setRoomAction("create");
                          handleCreateRoom();
                        }}
                        disabled={!vtReady}
                      >
                        <ShieldCheck className="h-4 w-4" />
                        房主创建
                      </Button>
                    )}
                    {!isHost && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => {
                          setRoomAction("join");
                          handleJoinRoom();
                        }}
                        disabled={!vtReady}
                      >
                        <Users className="h-4 w-4" />
                        访客加入
                      </Button>
                    )}
                    {isHost && (
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={handleCreateRoom}
                        disabled={!vtReady}
                      >
                        <Share2 className="h-4 w-4" />
                        重新创建
                      </Button>
                    )}
                  </div>
                </div>
                <CardDescription className="flex items-center gap-2">
                  <Badge variant="outline" className="uppercase">
                    {isHost ? "房主" : "观众"}
                  </Badge>
                  <span className="text-muted-foreground">
                    窗口默认最小化已开启，打开右下角图标即可展开控制
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="aspect-video bg-black rounded-lg overflow-hidden">
                  <VideoPlayer
                    key={`episode-${currentEpisode}`}
                    src={
                      currentEpisodeData?.videoUrl ||
                      overrideSrc ||
                      "https://media.onmicrosoft.cn/Re-He-Road-LIZHI-2018-Unplugged.mp4"
                    }
                    autoplay={false}
                    episodeId={currentEpisodeData?.id}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 order-2 lg:order-1 lg:col-span-1 lg:row-span-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-primary" />
                  同步聊天室
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={
                      chatStatus === "connected"
                        ? "bg-green-500/80 text-white"
                        : "bg-amber-200 text-amber-900"
                    }
                  >
                    {chatStatus === "connected" ? "已连接" : "连接已断开"}
                  </Badge>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>在线 {onlineUsers.length} 人</span>
                    <div className="flex flex-wrap gap-1">
                      {onlineUsers.map((user) => (
                        <Badge key={user} variant="outline" className="text-[11px]">
                          {user}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">我的昵称</p>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <Separator />
                <div
                  className="h-[420px] rounded-lg border bg-muted/40 p-3 overflow-y-auto"
                  ref={chatScrollRef}
                >
                  <div className="space-y-3">
                    {messages
                      .filter((message) => message.type !== "presence")
                      .map((message) => (
                        <div key={message.id} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{message.sender}</Badge>
                              {message.type === "system" && (
                                <Badge variant="secondary">系统</Badge>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {new Date(message.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">
                            {message.content}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="输入聊天内容，回车发送"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  <Button onClick={sendMessage} className="gap-2">
                    <Send className="h-4 w-4" />
                    发送
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Share2 className="h-4 w-4 text-primary" />
                  使用说明
                </CardTitle>
                <CardDescription className="space-y-2 text-sm">
                  <p>1. 页面加载完成后会自动注入 VideoTogether 脚本。</p>
                  <p>2. 默认创建房间并开启“窗口默认最小化”选项。</p>
                  <p>3. 将上方分享链接发给好友，访客会自动加入房间。</p>
                  <p>4. 房主切换剧集时，成员的视频地址会一起更新。</p>
                </CardDescription>
              </CardHeader>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-4 order-3 lg:order-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5 text-primary" />
                  房间信息
                </CardTitle>
                <CardDescription>
                  生成分享链接后，好友可直接进入该页面同步播放
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">房间名</p>
                  <Input
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">分享链接</p>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <Input value={shareLink} readOnly className="font-mono" />
                    <div className="flex gap-2">
                      <Button variant="outline" size="icon" onClick={copyShareLink}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Link href={shareLink}>
                        <Button variant="secondary" size="icon">
                          <Link2 className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <MonitorPlay className="h-5 w-5 text-primary" />
                  选集播放（房主切换会同步给成员）
                </CardTitle>
                <CardDescription>
                  当前 {currentEpisode} / {series.totalEpisodes}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[360px] pr-4">
                  <div className="grid md:grid-cols-2 gap-3">
                    {episodes.map((episode) => (
                      <button
                        key={episode.id}
                        onClick={() => handleEpisodeChange(episode.episode)}
                        className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all ${
                          currentEpisode === episode.episode
                            ? "border-primary bg-primary/5 shadow-lg"
                            : "border-border hover:border-primary/40 hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="min-w-16">
                              第 {episode.episode} 集
                            </Badge>
                            {episode.isVip && <ShieldCheck className="h-4 w-4 text-yellow-500" />}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {episode.duration}
                          </span>
                        </div>
                        <p className="font-medium leading-tight line-clamp-1">
                          {episode.title.replace(`第${episode.episode}集：`, "")}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {episode.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
