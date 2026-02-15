// @ts-nocheck
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/useTheme";
import { useSecurePIN } from "@/hooks/useSecurePIN";
import { useDeviceEncryption } from "@/hooks/useDeviceEncryption";
import { validatePinFormat } from "@/lib/security";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  Lock,
  Sun,
  Moon,
  Volume2,
  Clock,
  Shield,
  Loader2,
  Camera,
  User as UserIcon,
  AlertTriangle,
  Smartphone,
  Trash2,
  KeyRound,
  Mail,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

interface UserSettings {
  pin_enabled: boolean;
  sound_enabled: boolean;
}

interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  email: string | null;
}

const Settings = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [settings, setSettings] = useState<UserSettings>({
    pin_enabled: false,
    sound_enabled: true,
  });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinStep, setPinStep] = useState<"enter" | "confirm">("enter");
  const [pinError, setPinError] = useState<string | null>(null);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme(user?.id);
  const { setPin: setSecurePin, disablePin, getPinStatus } = useSecurePIN();
  const {
    isEnabled: deviceEncryptionEnabled,
    isReady: deviceEncryptionReady,
    loading: deviceEncryptionLoading,
    devices,
    currentDeviceId,
    enableEncryption,
    disableEncryption,
    revokeDevice,
  } = useDeviceEncryption(user?.id);

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      setUser(session.user);
      await fetchSettings(session.user.id);
      await fetchProfile(session.user.id);
      setLoading(false);
    };

    checkAuth();
  }, [navigate]);

  const fetchSettings = async (userId: string) => {
    // Use secure PIN status check
    const pinStatus = await getPinStatus();
    
    const { data } = await supabase
      .from("user_settings")
      .select("sound_enabled")
      .eq("user_id", userId)
      .maybeSingle();

    setSettings({
      pin_enabled: pinStatus?.pin_enabled || false,
      sound_enabled: data?.sound_enabled !== false,
    });
  };

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, email")
      .eq("user_id", userId)
      .maybeSingle();

    if (data) {
      setProfile(data);
      setEmailInput(data.email || "");
    }
  };

  const handleSaveEmail = async () => {
    if (!emailInput.trim()) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput)) {
      toast({ variant: "destructive", title: "Lỗi", description: "Email không hợp lệ" });
      return;
    }
    setSavingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('update-email', {
        body: { email: emailInput.trim().toLowerCase() }
      });
      if (error) throw error;
      if (data?.error) {
        toast({ variant: "destructive", title: "Lỗi", description: data.error });
        return;
      }
      setProfile(prev => prev ? { ...prev, email: emailInput.trim().toLowerCase() } : null);
      toast({ title: "Đã lưu", description: "Email đã được cập nhật" });
    } catch {
      toast({ variant: "destructive", title: "Lỗi", description: "Không thể cập nhật email" });
    } finally {
      setSavingEmail(false);
    }
  };

  const updateSettings = async (
    updates: Partial<UserSettings & { theme?: string }>
  ) => {
    if (!user) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("user_settings")
        .upsert(
          {
            user_id: user.id,
            sound_enabled: updates.sound_enabled ?? settings.sound_enabled,
          },
          { onConflict: "user_id" }
        );

      if (error) throw error;

      setSettings((prev) => ({
        ...prev,
        pin_enabled: updates.pin_enabled ?? prev.pin_enabled,
        sound_enabled: updates.sound_enabled ?? prev.sound_enabled,
      }));

      toast({
        title: "Đã lưu",
        description: "Cài đặt đã được cập nhật",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể lưu cài đặt",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleThemeChange = (newTheme: "dark" | "light") => {
    setTheme(newTheme);
  };

  const handlePinToggle = async (enabled: boolean) => {
    if (enabled) {
      setPin("");
      setConfirmPin("");
      setPinStep("enter");
      setPinError(null);
      setShowPinDialog(true);
    } else {
      // Disable PIN using secure function
      setSaving(true);
      const result = await disablePin();
      setSaving(false);
      
      if (result.success) {
        setSettings(prev => ({ ...prev, pin_enabled: false }));
        toast({
          title: "Đã tắt",
          description: "Mật mã đã được tắt",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: result.message,
        });
      }
    }
  };

  const handlePinSubmit = async () => {
    setPinError(null);
    
    if (pinStep === "enter") {
      // Validate PIN format
      const validation = validatePinFormat(pin);
      if (!validation.valid) {
        setPinError(validation.error || "PIN không hợp lệ");
        return;
      }
      setPinStep("confirm");
    } else {
      if (pin !== confirmPin) {
        setPinError("Mã PIN không khớp");
        setConfirmPin("");
        return;
      }

      // Save PIN using secure server-side function
      setSaving(true);
      const result = await setSecurePin(pin);
      setSaving(false);
      
      if (result.success) {
        setSettings(prev => ({ ...prev, pin_enabled: true }));
        setShowPinDialog(false);
        setPin("");
        setConfirmPin("");
        toast({
          title: "Đã lưu",
          description: "Mật mã đã được đặt thành công",
        });
      } else {
        setPinError(result.message);
      }
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file
    if (!file.type.startsWith("image/")) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Vui lòng chọn file ảnh",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Kích thước ảnh tối đa là 5MB",
      });
      return;
    }

    setUploadingAvatar(true);

    try {
      // Delete old avatar if exists
      if (profile?.avatar_url) {
        const oldPath = profile.avatar_url.split("/").pop();
        if (oldPath) {
          await supabase.storage
            .from("avatars")
            .remove([`${user.id}/${oldPath}`]);
        }
      }

      // Upload new avatar
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      // Update profile with new avatar URL
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: urlData.publicUrl })
        .eq("user_id", user.id);

      if (updateError) throw updateError;

      setProfile((prev) =>
        prev ? { ...prev, avatar_url: urlData.publicUrl } : null
      );

      toast({
        title: "Thành công",
        description: "Đã cập nhật ảnh đại diện",
      });
    } catch (error) {
      console.error("Avatar upload error:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật ảnh đại diện",
      });
    } finally {
      setUploadingAvatar(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="h-16 border-b border-border flex items-center px-4 gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/chat")}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-foreground">Cài đặt</h1>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-md mx-auto p-4 space-y-6">
        {/* Avatar Section */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex flex-col items-center">
            <div className="relative mb-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleAvatarChange}
                accept="image/*"
                className="hidden"
              />
              <button
                onClick={handleAvatarClick}
                disabled={uploadingAvatar}
                className="relative w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-primary transition-all disabled:opacity-50"
              >
                {uploadingAvatar ? (
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                ) : profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <UserIcon className="w-10 h-10 text-primary" />
                )}
                <div className="absolute inset-0 bg-background/60 opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity">
                  <Camera className="w-6 h-6 text-foreground" />
                </div>
              </button>
            </div>
            <p className="font-medium text-foreground">{profile?.username}</p>
            <p className="text-sm text-muted-foreground">
              Bấm vào ảnh để thay đổi
            </p>
          </div>
        </div>

        {/* Email Section */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Mail className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-foreground">Email khôi phục</h3>
              <p className="text-sm text-muted-foreground">
                Dùng để lấy lại mật khẩu khi quên
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="example@gmail.com"
              value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              className="h-10 bg-background border-border"
              disabled={savingEmail}
            />
            <Button
              size="sm"
              className="h-10 px-4"
              onClick={handleSaveEmail}
              disabled={savingEmail || emailInput === (profile?.email || "")}
            >
              {savingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </Button>
          </div>
          {profile?.email && (
            <p className="text-xs text-muted-foreground">
              Email hiện tại: <span className="text-foreground">{profile.email}</span>
            </p>
          )}
        </div>

        {/* PIN Code */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-foreground">Mật mã 6 số</h3>
              <p className="text-sm text-muted-foreground">
                Bảo vệ tin nhắn khi đăng nhập
              </p>
            </div>
            <Switch
              checked={settings.pin_enabled}
              onCheckedChange={handlePinToggle}
              disabled={saving}
            />
          </div>
        </div>

        {/* Theme */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <h3 className="font-medium text-foreground flex items-center gap-2">
            <Sun className="w-4 h-4" />
            Giao diện
          </h3>
          <div className="flex gap-2">
            <Button
              variant={theme === "light" ? "default" : "outline"}
              className="flex-1"
              onClick={() => handleThemeChange("light")}
              disabled={saving}
            >
              <Sun className="w-4 h-4 mr-2" />
              Sáng
            </Button>
            <Button
              variant={theme === "dark" ? "default" : "outline"}
              className="flex-1"
              onClick={() => handleThemeChange("dark")}
              disabled={saving}
            >
              <Moon className="w-4 h-4 mr-2" />
              Tối
            </Button>
          </div>
        </div>

        {/* Sound */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Volume2 className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-foreground">Âm thanh thông báo</h3>
              <p className="text-sm text-muted-foreground">
                Phát âm thanh khi có tin nhắn mới
              </p>
            </div>
            <Switch
              checked={settings.sound_enabled}
              onCheckedChange={(enabled) =>
                updateSettings({ sound_enabled: enabled })
              }
              disabled={saving}
            />
          </div>
        </div>

        {/* Device Encryption */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-foreground">Mã hoá thiết bị</h3>
              <p className="text-sm text-muted-foreground">
                Bảo mật nâng cao — chỉ thiết bị này đọc được tin nhắn
              </p>
            </div>
            <Switch
              checked={deviceEncryptionEnabled}
              onCheckedChange={async (enabled) => {
                if (enabled) {
                  const success = await enableEncryption();
                  toast({
                    title: success ? "Đã bật" : "Lỗi",
                    description: success
                      ? "Mã hoá thiết bị đã được kích hoạt"
                      : "Không thể bật mã hoá thiết bị",
                    variant: success ? "default" : "destructive",
                  });
                } else {
                  const success = await disableEncryption();
                  toast({
                    title: success ? "Đã tắt" : "Lỗi",
                    description: success
                      ? "Mã hoá thiết bị đã được tắt"
                      : "Không thể tắt mã hoá thiết bị",
                    variant: success ? "default" : "destructive",
                  });
                }
              }}
              disabled={deviceEncryptionLoading}
            />
          </div>

          {deviceEncryptionEnabled && (
            <>
              {/* Warning */}
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm">
                <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                <p className="text-destructive">
                  Nếu bạn mất thiết bị hoặc xoá trình duyệt, tin nhắn đã mã hoá sẽ <strong>không thể khôi phục</strong>. Private key chỉ lưu trên thiết bị này.
                </p>
              </div>

              {/* Device list */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5" />
                  Thiết bị đã đăng ký ({devices.length})
                </h4>
                {devices.map((device) => (
                  <div
                    key={device.id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      device.id === currentDeviceId
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Smartphone className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {device.device_name}
                          {device.id === currentDeviceId && (
                            <span className="ml-2 text-xs text-primary font-normal">(thiết bị này)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          ID: {device.device_fingerprint.substring(0, 8)}… · {new Date(device.last_active).toLocaleDateString("vi-VN")}
                        </p>
                      </div>
                    </div>
                    {device.id !== currentDeviceId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={revokingDeviceId === device.id}
                        onClick={async () => {
                          setRevokingDeviceId(device.id);
                          const success = await revokeDevice(device.id);
                          setRevokingDeviceId(null);
                          toast({
                            title: success ? "Đã thu hồi" : "Lỗi",
                            description: success
                              ? "Thiết bị đã bị thu hồi"
                              : "Không thể thu hồi thiết bị",
                            variant: success ? "default" : "destructive",
                          });
                        }}
                      >
                        {revokingDeviceId === device.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Info */}
        <div className="bg-muted/50 border border-border rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div>
              <h3 className="font-medium text-foreground">Xóa tự động 24 giờ</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Tin nhắn sẽ tự động hết hạn sau 24 giờ. Bạn có thể tắt chức năng
                này trong từng cuộc trò chuyện (cần sự đồng ý của cả 2 bên).
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* PIN Dialog */}
      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>
              {pinStep === "enter" ? "Đặt mật mã" : "Xác nhận mật mã"}
            </DialogTitle>
            <DialogDescription>
              {pinStep === "enter"
                ? "Nhập mã 6 số để bảo vệ tin nhắn"
                : "Nhập lại mã 6 số để xác nhận"}
            </DialogDescription>
          </DialogHeader>
          
          {pinError && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {pinError}
            </div>
          )}
          
          <div className="flex justify-center py-4">
            <InputOTP
              maxLength={6}
              value={pinStep === "enter" ? pin : confirmPin}
              onChange={(value) => {
                pinStep === "enter" ? setPin(value) : setConfirmPin(value);
                setPinError(null);
              }}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPinDialog(false)} disabled={saving}>
              Hủy
            </Button>
            <Button onClick={handlePinSubmit} disabled={saving}>
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                pinStep === "enter" ? "Tiếp tục" : "Xác nhận"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Settings;