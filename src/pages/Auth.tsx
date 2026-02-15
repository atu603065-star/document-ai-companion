// @ts-nocheck
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Shield, Lock, User, Eye, EyeOff, ArrowRight, Loader2, AlertTriangle, Mail, ArrowLeft } from "lucide-react";
import { z } from "zod";
import { sanitizeInput, checkRateLimit, clearRateLimit, secureSessionStorage } from "@/lib/security";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

const authSchema = z.object({
  username: z.string().min(3, "ID phải có ít nhất 3 ký tự").max(20, "ID không được quá 20 ký tự").regex(/^[a-zA-Z0-9_]+$/, "ID chỉ được chứa chữ cái, số và dấu gạch dưới").transform(val => sanitizeInput(val.toLowerCase().trim())),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự").max(100, "Mật khẩu không được quá 100 ký tự")
});

type AuthView = "login" | "register" | "forgot" | "verify-code" | "new-password";

const Auth = () => {
  const [view, setView] = useState<AuthView>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ username?: string; password?: string; email?: string }>({});
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  // Forgot password state
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [forgotUsername, setForgotUsername] = useState("");

  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) navigate("/chat");
    };
    checkSession();
  }, [navigate]);

  useEffect(() => {
    secureSessionStorage.remove("pin_verified");
  }, []);

  const isLogin = view === "login";
  const isRegister = view === "register";

  const validateForm = () => {
    try {
      if (isRegister) {
        authSchema.parse({ username, password });
        if (email && !z.string().email().safeParse(email).success) {
          setErrors(prev => ({ ...prev, email: "Email không hợp lệ" }));
          return false;
        }
      } else {
        authSchema.parse({ username, password });
      }
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: { username?: string; password?: string } = {};
        error.errors.forEach(err => {
          if (err.path[0] === "username") fieldErrors.username = err.message;
          if (err.path[0] === "password") fieldErrors.password = err.message;
        });
        setErrors(fieldErrors);
      }
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRateLimitError(null);
    if (!validateForm()) return;
    const normalizedUsername = sanitizeInput(username.toLowerCase().trim());

    const rateLimitKey = `auth_${normalizedUsername}`;
    const rateLimit = checkRateLimit(rateLimitKey, 5, 60000);
    if (!rateLimit.allowed) {
      setRateLimitError(`Quá nhiều lần thử. Vui lòng đợi ${Math.ceil(rateLimit.resetIn / 1000)} giây.`);
      return;
    }
    setIsLoading(true);
    try {
      const emailAddr = `${normalizedUsername}@secure-chat.local`;
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email: emailAddr, password });
        if (error) {
          toast({ variant: "destructive", title: "Đăng nhập thất bại", description: "ID hoặc mật khẩu không chính xác" });
          return;
        }
        clearRateLimit(rateLimitKey);
        toast({ title: "Đăng nhập thành công", description: "Chào mừng bạn quay trở lại!" });
        navigate("/chat");
      } else {
        const { data: existingProfile } = await supabase.from("profiles").select("username").ilike("username", normalizedUsername).maybeSingle();
        if (existingProfile) {
          toast({ variant: "destructive", title: "Đăng ký thất bại", description: "ID này đã được sử dụng" });
          return;
        }
        const { error } = await supabase.auth.signUp({
          email: emailAddr,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { username: normalizedUsername }
          }
        });
        if (error) {
          toast({ variant: "destructive", title: "Đăng ký thất bại", description: error.message.includes("already registered") ? "ID này đã được sử dụng" : "Có lỗi xảy ra" });
          return;
        }

        // If email provided, save it to profile after signup
        if (email.trim()) {
          // Wait a bit for trigger to create profile
          setTimeout(async () => {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (session) {
                await supabase.functions.invoke('update-email', {
                  body: { email: email.trim().toLowerCase() }
                });
              }
            } catch {}
          }, 1500);
        }

        clearRateLimit(rateLimitKey);
        toast({ title: "Đăng ký thành công", description: "Tài khoản đã được tạo!" });
        navigate("/chat");
      }
    } catch {
      toast({ variant: "destructive", title: "Lỗi", description: "Có lỗi xảy ra" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotUsername.trim()) {
      setErrors({ username: "Vui lòng nhập ID" });
      return;
    }
    setIsLoading(true);
    setErrors({});
    try {
      const { data, error } = await supabase.functions.invoke('send-reset-code', {
        body: { username: forgotUsername.trim().toLowerCase() }
      });
      if (error) throw error;
      if (data.error) {
        toast({ variant: "destructive", title: "Lỗi", description: data.error });
        setIsLoading(false);
        return;
      }
      if (data.maskedEmail) {
        setMaskedEmail(data.maskedEmail);
      }
      toast({ title: "Đã gửi mã", description: `Mã khôi phục đã được gửi đến ${data.maskedEmail || 'email của bạn'}` });
      setView("verify-code");
    } catch {
      toast({ variant: "destructive", title: "Lỗi", description: "Không thể gửi mã, vui lòng thử lại" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (resetCode.length !== 6) return;
    setView("new-password");
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setErrors({ password: "Mật khẩu phải có ít nhất 6 ký tự" });
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-reset-code', {
        body: {
          username: forgotUsername.trim().toLowerCase(),
          code: resetCode,
          newPassword,
        }
      });
      if (error) throw error;
      if (data.error) {
        toast({ variant: "destructive", title: "Lỗi", description: data.error });
        if (data.error.includes('hết hạn') || data.error.includes('không hợp lệ')) {
          setView("verify-code");
          setResetCode("");
        }
        setIsLoading(false);
        return;
      }
      toast({ title: "Thành công!", description: "Mật khẩu đã được đặt lại. Hãy đăng nhập lại." });
      setView("login");
      setUsername(forgotUsername);
      setPassword("");
      setResetCode("");
      setNewPassword("");
      setForgotUsername("");
    } catch {
      toast({ variant: "destructive", title: "Lỗi", description: "Không thể đặt lại mật khẩu" });
    } finally {
      setIsLoading(false);
    }
  };

  const renderForgotFlow = () => {
    if (view === "forgot") {
      return (
        <form onSubmit={handleSendResetCode} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="forgot-username" className="text-foreground">ID người dùng</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input id="forgot-username" placeholder="Nhập ID của bạn" value={forgotUsername} onChange={e => setForgotUsername(e.target.value)} className="pl-11 h-12 bg-background border-border" disabled={isLoading} />
            </div>
            {errors.username && <p className="text-sm text-destructive">{errors.username}</p>}
          </div>
          <Button type="submit" className="w-full h-12" disabled={isLoading}>
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Gửi mã khôi phục <Mail className="w-5 h-5 ml-2" /></>}
          </Button>
        </form>
      );
    }

    if (view === "verify-code") {
      return (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground text-center">
            Mã đã gửi đến <strong className="text-foreground">{maskedEmail}</strong>
          </p>
          <div className="flex justify-center py-2">
            <InputOTP maxLength={6} value={resetCode} onChange={setResetCode}>
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
          <Button className="w-full h-12" disabled={resetCode.length !== 6} onClick={handleVerifyCode}>
            Xác nhận mã <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setView("forgot")}>
            Gửi lại mã
          </Button>
        </div>
      );
    }

    if (view === "new-password") {
      return (
        <form onSubmit={handleResetPassword} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="new-password" className="text-foreground">Mật khẩu mới</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input id="new-password" type={showNewPassword ? "text" : "password"} placeholder="Nhập mật khẩu mới" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="pl-11 pr-11 h-12 bg-background border-border" disabled={isLoading} />
              <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
          </div>
          <Button type="submit" className="w-full h-12" disabled={isLoading}>
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Đặt lại mật khẩu <ArrowRight className="w-5 h-5 ml-2" /></>}
          </Button>
        </form>
      );
    }
  };

  const isForgotFlow = view === "forgot" || view === "verify-code" || view === "new-password";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="animate-fade-in">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-bold mb-2 text-secondary-foreground">AnndChat</h1>
            <p className="text-muted-foreground">
              {isForgotFlow ? "Khôi phục mật khẩu" : "Nhắn tin bảo mật, riêng tư tuyệt đối"}
            </p>
          </div>

          {/* Card */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
            {isForgotFlow ? (
              <>
                <button onClick={() => { setView("login"); setErrors({}); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Quay lại đăng nhập
                </button>
                <h2 className="text-lg font-semibold text-foreground mb-1">
                  {view === "forgot" && "Quên mật khẩu"}
                  {view === "verify-code" && "Nhập mã xác nhận"}
                  {view === "new-password" && "Đặt mật khẩu mới"}
                </h2>
                <p className="text-sm text-muted-foreground mb-6">
                  {view === "forgot" && "Nhập ID để nhận mã khôi phục qua email"}
                  {view === "verify-code" && "Nhập mã 6 số đã gửi đến email của bạn"}
                  {view === "new-password" && "Tạo mật khẩu mới cho tài khoản"}
                </p>
                {renderForgotFlow()}
              </>
            ) : (
              <>
                {/* Tab Switcher */}
                <div className="flex bg-muted rounded-xl p-1 mb-6">
                  <button onClick={() => setView("login")} className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${isLogin ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"}`}>
                    Đăng nhập
                  </button>
                  <button onClick={() => setView("register")} className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${isRegister ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"}`}>
                    Đăng ký
                  </button>
                </div>

                {rateLimitError && (
                  <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm mb-4">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {rateLimitError}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-foreground">ID người dùng</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input id="username" type="text" placeholder="Nhập ID của bạn" value={username} onChange={e => setUsername(e.target.value)} className={`pl-11 h-12 bg-background border-border ${errors.username ? "border-destructive" : ""}`} disabled={isLoading} autoComplete="username" />
                    </div>
                    {errors.username && <p className="text-sm text-destructive">{errors.username}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-foreground">Mật khẩu</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input id="password" type={showPassword ? "text" : "password"} placeholder="Nhập mật khẩu" value={password} onChange={e => setPassword(e.target.value)} className={`pl-11 pr-11 h-12 bg-background border-border ${errors.password ? "border-destructive" : ""}`} disabled={isLoading} autoComplete={isLogin ? "current-password" : "new-password"} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1}>
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                    {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
                  </div>

                  {/* Email field for registration */}
                  {isRegister && (
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-foreground">
                        Email <span className="text-muted-foreground font-normal">(tuỳ chọn)</span>
                      </Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                        <Input id="email" type="email" placeholder="example@gmail.com" value={email} onChange={e => setEmail(e.target.value)} className={`pl-11 h-12 bg-background border-border ${errors.email ? "border-destructive" : ""}`} disabled={isLoading} autoComplete="email" />
                      </div>
                      {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                      <p className="text-xs text-muted-foreground">Dùng để khôi phục mật khẩu khi quên</p>
                    </div>
                  )}

                  {/* Forgot password link */}
                  {isLogin && (
                    <button type="button" onClick={() => { setView("forgot"); setErrors({}); setForgotUsername(username); }} className="text-sm text-primary hover:underline">
                      Quên mật khẩu?
                    </button>
                  )}

                  <Button type="submit" className="w-full h-12" disabled={isLoading}>
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>
                      {isLogin ? "Đăng nhập" : "Tạo tài khoản"}
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </>}
                  </Button>
                </form>
              </>
            )}
          </div>

          <div className="mt-6 text-center">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Lock className="w-3 h-3" />
              Mã hóa đầu cuối • Bảo mật tối đa
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
