"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { VideoPlayer } from "@/components/video-player";
import { apiClient, EpisodeAPI, SeriesAPI } from "@/lib/api";
import {
  ArrowLeft,
  Copy,
  Crown,
  Link2,
  Loader2,
  MessageCircle,
  Monitor,
  Send,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";

type ChatMessage = {
  id: string;
  type: "chat" | "system" | "episode-change" | "history" | "error";
  user?: string;
  content?: string;
  timestamp?: string;
  episode?: number;
  videoUrl?: string;
  title?: string;
};

const getDefaultRoomName = (hash: string) => `selfcinema-${hash}`;
const getDefaultPassword = (hash: string) => `pw-${hash.slice(0, 6)}`;

const buildWsUrl = (roomName: string) => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const api = new URL(apiBase);
    const protocol = api.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${api.host}/ws/watch-together/${encodeURIComponent(roomName)}`;
  } catch {
    const protocol = apiBase.startsWith("https") ? "wss" : "ws";
    return `${protocol}://${apiBase.replace(/^https?:\/\//, "")}/ws/watch-together/${encodeURIComponent(
      roomName,
    )}`;
  }
};

export default function WatchTogetherPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hash = params.hash as string;

  const initialAction = (searchParams.get("action") || "create").toLowerCase();
  const initialEpisode = parseInt(searchParams.get("episode") || "1", 10);
  const [series, setSeries] = useState<SeriesAPI | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeAPI[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState<number>(initialEpisode);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [roomName, setRoomName] = useState(() => searchParams.get("room") || getDefaultRoomName(hash));
  const [roomPassword, setRoomPassword] = useState(() => searchParams.get("password") || getDefaultPassword(hash));
  const [displayName, setDisplayName] = useState(() => searchParams.get("user") || `影迷-${Math.floor(Math.random() * 900 + 100)}`);
  const [isHost, setIsHost] = useState(initialAction !== "join");

  const [vtReady, setVtReady] = useState(false);
  const [vtLoading, setVtLoading] = useState(false);
  const [vtError, setVtError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStatus, setChatStatus] = useState<"connecting" | "connected" | "idle" | "error">("idle");

  const socketRef = useRef<WebSocket | null>(null);
  const scriptAttachedRef = useRef(false);
  const roomActionDoneRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const episodesRef = useRef<EpisodeAPI[]>([]);
  const isHostRef = useRef(isHost);
  const displayNameRef = useRef(displayName);
  const currentEpisodeRef = useRef(currentEpisode);

  useEffect(() => {
    episodesRef.current = episodes;
  }, [episodes]);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);

  useEffect(() => {
    currentEpisodeRef.current = currentEpisode;
  }, [currentEpisode]);

  const currentEpisodeData = useMemo(
    () => episodes.find((episode) => episode.episode === currentEpisode),
    [episodes, currentEpisode],
  );

  const shareLink = useMemo(() => {
    if (typeof window === "undefined") return "";
    const baseUrl = `${window.location.origin}/watch-together/${hash}`;
    const params = new URLSearchParams({
      room: roomName,
      password: roomPassword,
      action: "join",
      episode: String(currentEpisode),
      user: displayName,
    });
    return `${baseUrl}?${params.toString()}`;
  }, [hash, roomName, roomPassword, currentEpisode, displayName]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const data = await apiClient.getWatchData(hash);
        setSeries(data.series);
        setEpisodes(data.episodes);
        if (!data.episodes.find((ep) => ep.episode === initialEpisode)) {
          setCurrentEpisode(data.episodes[0]?.episode || 1);
        }
      } catch (err) {
        console.error(err);
        setError("分享链接无效或数据加载失败");
      } finally {
        setIsLoading(false);
      }
    };

    if (hash) {
      fetchData();
    }
  }, [hash, initialEpisode]);

  const applyDefaultSettings = () => {
    setTimeout(() => {
      window.postMessage(
        {
          type: 15,
          source: "VideoTogether",
          data: {
            key: "MinimiseDefault",
            value: true,
          },
        },
        "*",
      );
    }, 600);
  };

  const handleRoomEnter = useCallback(
    (action: "create" | "join") => {
      if (!window.videoTogetherExtension) {
        setVtError("VideoTogether 尚未准备好，请稍后重试");
        return;
      }
      if (roomActionDoneRef.current) {
        return;
      }

      if (action === "create") {
        window.videoTogetherExtension.CreateRoom(roomName, roomPassword);
        setIsHost(true);
      } else {
        window.videoTogetherExtension.JoinRoom(roomName, roomPassword);
        setIsHost(false);
      }

      roomActionDoneRef.current = true;

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("action");
      router.replace(newUrl.pathname + newUrl.search, { scroll: false });
    },
    [roomName, roomPassword, router],
  );

  const loadVideoTogether = useCallback(() => {
    if (scriptAttachedRef.current) return;
    setVtLoading(true);
    const script = document.createElement("script");
    script.src = "/extension.website.user.js";
    script.async = true;

    const onReady = () => {
      setVtReady(true);
      setVtLoading(false);
      applyDefaultSettings();
      handleRoomEnter(initialAction === "join" ? "join" : "create");
    };

    script.onload = onReady;
    script.onerror = () => {
      setVtError("本地加载 VideoTogether 失败，尝试使用 CDN");
      const fallback = document.createElement("script");
      fallback.src = "https://fastly.jsdelivr.net/gh/VideoTogether/VideoTogether@latest/release/extension.website.user.js";
      fallback.async = true;
      fallback.onload = onReady;
      fallback.onerror = () => {
        setVtLoading(false);
        setVtError("VideoTogether 无法加载，请检查网络");
      };
      document.body.appendChild(fallback);
    };

    document.body.appendChild(script);
    scriptAttachedRef.current = true;
  }, [handleRoomEnter, initialAction]);

  useEffect(() => {
    loadVideoTogether();
  }, [loadVideoTogether]);

  const connectChat = useCallback(() => {
    if (!roomName) return;
    setChatStatus("connecting");
    const ws = new WebSocket(buildWsUrl(roomName));
    socketRef.current = ws;

    ws.onopen = () => {
      setChatStatus("connected");
      ws.send(
        JSON.stringify({
          type: "system",
          content: `${displayNameRef.current} 进入了房间`,
          user: displayNameRef.current,
        }),
      );

      if (isHostRef.current) {
        const episodeInfo = episodesRef.current.find((ep) => ep.episode === currentEpisodeRef.current);
        ws.send(
          JSON.stringify({
            type: "episode-change",
            user: displayNameRef.current,
            episode: currentEpisodeRef.current,
            videoUrl: episodeInfo?.videoUrl,
            title: episodeInfo?.title,
          }),
        );
      }
    };

    ws.onclose = () => {
      setChatStatus("idle");
    };

    ws.onerror = () => {
      setChatStatus("error");
    };

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "history" && Array.isArray(payload.messages)) {
        setChatMessages(payload.messages.map((msg: ChatMessage, index: number) => ({ ...msg, id: `${Date.now()}-${index}` })));
        return;
      }

      const normalized: ChatMessage = {
        ...payload,
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
      };

      if (normalized.type === "episode-change" && typeof normalized.episode === "number") {
        if (!(isHostRef.current && normalized.user === displayNameRef.current)) {
          setCurrentEpisode(normalized.episode);
          const targetEpisode = episodesRef.current.find((ep) => ep.episode === normalized.episode);
          if (targetEpisode) {
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set("episode", String(normalized.episode));
            router.replace(newUrl.pathname + newUrl.search, { scroll: false });
          }
        }
      }

      setChatMessages((prev) => [...prev.slice(-99), normalized]);
    };
  }, [roomName, router]);

  useEffect(() => {
    connectChat();
    return () => {
      socketRef.current?.close();
    };
  }, [connectChat]);

  const handleSendMessage = () => {
    if (!chatInput.trim() || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    const message = {
      type: "chat",
      content: chatInput.trim(),
      user: displayName,
    };
    socketRef.current.send(JSON.stringify(message));
    setChatInput("");
  };

  const handleEpisodeChange = (episodeNumber: number) => {
    setCurrentEpisode(episodeNumber);

    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("episode", episodeNumber.toString());
    router.replace(newUrl.pathname + newUrl.search, { scroll: false });

    if (isHost && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const targetEpisode = episodes.find((ep) => ep.episode === episodeNumber);
      socketRef.current.send(
        JSON.stringify({
          type: "episode-change",
          user: displayName,
          episode: episodeNumber,
          videoUrl: targetEpisode?.videoUrl,
          title: targetEpisode?.title,
        }),
      );
    }
  };

  const regeneratePassword = () => {
    const newPassword = Math.random().toString(36).slice(2, 8);
    setRoomPassword(newPassword);
    roomActionDoneRef.current = false;
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
    } catch (err) {
      console.error(err);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">正在加载剧集信息...</p>
        </div>
      </div>
    );
  }

  if (error || !series) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">加载失败</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/50 bg-background/80 backdrop-blur-lg sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
              返回
            </Button>
            <div>
              <p className="text-sm font-semibold">{series.title}</p>
              <p className="text-xs text-muted-foreground">一起看 · 房间 {roomName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Users className="h-3 w-3" />
              {isHost ? "房主" : "成员"}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <MessageCircle className="h-3 w-3" />
              {chatStatus === "connected" ? "聊天已连接" : chatStatus === "connecting" ? "连接中..." : "等待连接"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-3 space-y-4">
          <Card className="overflow-hidden border-2 border-border/60 shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div className="flex items-center gap-2">
                <Monitor className="h-5 w-5 text-primary" />
                <CardTitle>一起看播放器</CardTitle>
              </div>
              {vtLoading ? (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  插件加载中
                </Badge>
              ) : vtReady ? (
                <Badge variant="outline" className="gap-1">
                  <Sparkles className="h-3 w-3" />
                  插件已就绪
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <Shield className="h-3 w-3" />
                  插件未加载
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="aspect-video rounded-lg overflow-hidden bg-black">
                <VideoPlayer
                  key={`episode-${currentEpisode}`}
                  src={currentEpisodeData?.videoUrl || ""}
                  autoplay
                  episodeId={currentEpisodeData?.id}
                />
              </div>
              {vtError && (
                <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-md p-2">
                  {vtError}
                </div>
              )}
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="gap-1">
                  <Crown className="h-3 w-3 text-yellow-500" />
                  房主切换集数会自动同步给成员
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Crown className="h-3 w-3 text-primary" />
                  插件窗口默认最小化
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-border/60">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-primary" />
                  <CardTitle>房间与分享</CardTitle>
                </div>
                <Badge variant="secondary" className="gap-1">
                  <Users className="h-3 w-3" />
                  {roomName}
                </Badge>
              </div>
              <CardDescription>创建或加入房间后，复制链接邀请好友一起看</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">房间名</label>
                  <Input value={roomName} onChange={(e) => setRoomName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center justify-between">
                    <span>房间密码</span>
                    <button className="text-xs text-primary" onClick={regeneratePassword} type="button">
                      重新生成
                    </button>
                  </label>
                  <Input value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">我的昵称</label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="gap-2" onClick={() => { roomActionDoneRef.current = false; handleRoomEnter("create"); }}>
                  <Crown className="h-4 w-4" />
                  创建房间
                </Button>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => { roomActionDoneRef.current = false; handleRoomEnter("join"); }}>
                  <Users className="h-4 w-4" />
                  加入房间
                </Button>
                <Button size="sm" variant="secondary" className="gap-2" onClick={loadVideoTogether} disabled={vtLoading}>
                  {vtLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  重新加载插件
                </Button>
              </div>

              <Separator />

              <div className="space-y-2">
                <label className="text-sm font-medium">分享链接</label>
                <div className="flex gap-2">
                  <Input value={shareLink} readOnly />
                  <Button type="button" variant="outline" className="shrink-0 gap-2" onClick={copyShareLink}>
                    <Copy className="h-4 w-4" />
                    复制
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Monitor className="h-5 w-5 text-primary" />
                选集播放（房主同步）
              </CardTitle>
              <CardDescription>房主更换集数会通过聊天频道同步给所有成员</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64">
                <div className="grid md:grid-cols-2 gap-3">
                  {episodes.map((episode) => (
                    <button
                      key={episode.id}
                      onClick={() => handleEpisodeChange(episode.episode)}
                      className={`text-left border rounded-lg p-3 transition-all ${
                        currentEpisode === episode.episode ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold text-sm truncate">{episode.title.replace(`第${episode.episode}集：`, "")}</p>
                        {episode.isVip && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Crown className="h-3 w-3 text-yellow-500" />
                            VIP
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{episode.description}</p>
                      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                        <span>第 {episode.episode} 集</span>
                        <span>{episode.duration}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-2 space-y-4">
          <Card className="border-2 border-border/60 h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-primary" />
                <CardTitle>聊天室</CardTitle>
              </div>
              <Badge variant={chatStatus === "connected" ? "secondary" : "outline"}>
                {chatStatus === "connected" ? "已连接" : chatStatus === "connecting" ? "连接中" : "等待连接"}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col h-[520px]">
              <ScrollArea className="flex-1 pr-2">
                <div className="space-y-3">
                  {chatMessages.map((message) => (
                    <div key={message.id} className="text-sm rounded-lg p-3 border border-border/60 bg-muted/30">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{message.user || "系统"}</span>
                        <span className="text-xs text-muted-foreground">
                          {message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : ""}
                        </span>
                      </div>
                      {message.type === "episode-change" ? (
                        <p className="text-xs text-primary flex items-center gap-1">
                          <Crown className="h-4 w-4" />
                          房主切换到第 {message.episode} 集：{message.title || "新片源"}
                        </p>
                      ) : (
                        <p className="text-sm leading-relaxed">{message.content}</p>
                      )}
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              </ScrollArea>
              <div className="mt-3 space-y-2">
                <Textarea
                  placeholder="和大家聊聊观影感受吧～"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="min-h-[90px]"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">左侧播放内容与 VideoTogether 会同步到房间成员</p>
                  <Button size="sm" className="gap-2" onClick={handleSendMessage} disabled={chatStatus !== "connected"}>
                    <Send className="h-4 w-4" />
                    发送
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
