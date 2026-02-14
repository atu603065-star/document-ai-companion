import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Shield, Lock, User, Eye, EyeOff, ArrowRight, Loader2, AlertTriangle } from "lucide-react";
import { z } from "zod";
import { sanitizeInput, checkRateLimit, clearRateLimit, secureSessionStorage } from "@/lib/security";

// Enhanced security schema with stronger validation
const authSchema = z.object({
  username: z.string().min(3, "ID phải có ít nhất 3 ký tự").max(20, "ID không được quá 20 ký tự").regex(/^[a-zA-Z0-9_]+$/, "ID chỉ được chứa chữ cái, số và dấu gạch dưới").transform(val => sanitizeInput(val.toLowerCase().trim())),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự").max(100, "Mật khẩu không được quá 100 ký tự")
});
const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{
    username?: string;
    password?: string;
  }>({});
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const navigate = useNavigate();
  const {
    toast
  } = useToast();

  // Check if already authenticated
  useEffect(() => {
    const checkSession = async () => {
      const {
        data: {
          session
        }
      } = await supabase.auth.getSession();
      if (session) {
        navigate("/chat");
      }
    };
    checkSession();
  }, [navigate]);

  // Clear session storage on mount to ensure clean state
  useEffect(() => {
    secureSessionStorage.remove("pin_verified");
  }, []);
  const validateForm = () => {
    try {
      authSchema.parse({
        username,
        password
      });
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: {
          username?: string;
          password?: string;
        } = {};
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

    // Client-side rate limiting
    const rateLimitKey = `auth_${normalizedUsername}`;
    const rateLimit = checkRateLimit(rateLimitKey, 5, 60000);
    if (!rateLimit.allowed) {
      const waitSeconds = Math.ceil(rateLimit.resetIn / 1000);
      setRateLimitError(`Quá nhiều lần thử. Vui lòng đợi ${waitSeconds} giây.`);
      return;
    }
    setIsLoading(true);
    try {
      const email = `${normalizedUsername}@secure-chat.local`;
      if (isLogin) {
        const {
          error
        } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (error) {
          // Don't reveal if user exists or not
          toast({
            variant: "destructive",
            title: "Đăng nhập thất bại",
            description: "ID hoặc mật khẩu không chính xác"
          });
          return;
        }

        // Clear rate limit on success
        clearRateLimit(rateLimitKey);
        toast({
          title: "Đăng nhập thành công",
          description: "Chào mừng bạn quay trở lại!"
        });
        navigate("/chat");
      } else {
        // Check if username already exists
        const {
          data: existingProfile
        } = await supabase.from("profiles").select("username").ilike("username", normalizedUsername).maybeSingle();
        if (existingProfile) {
          toast({
            variant: "destructive",
            title: "Đăng ký thất bại",
            description: "ID này đã được sử dụng, vui lòng chọn ID khác"
          });
          return;
        }
        const {
          error
        } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              username: normalizedUsername
            }
          }
        });
        if (error) {
          if (error.message.includes("already registered")) {
            toast({
              variant: "destructive",
              title: "Đăng ký thất bại",
              description: "ID này đã được sử dụng"
            });
          } else {
            toast({
              variant: "destructive",
              title: "Đăng ký thất bại",
              description: "Có lỗi xảy ra, vui lòng thử lại"
            });
          }
          return;
        }

        // Clear rate limit on success
        clearRateLimit(rateLimitKey);
        toast({
          title: "Đăng ký thành công",
          description: "Tài khoản đã được tạo, đang chuyển hướng..."
        });
        navigate("/chat");
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Có lỗi xảy ra, vui lòng thử lại sau"
      });
    } finally {
      setIsLoading(false);
    }
  };
  return <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="animate-fade-in">
          {/* Logo & Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-bold mb-2 text-secondary-foreground">AnndChat</h1>
            <p className="text-muted-foreground">Nhắn tin bảo mật, riêng tư tuyệt đối</p>
          </div>

          {/* Auth Card */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
            {/* Tab Switcher */}
            <div className="flex bg-muted rounded-xl p-1 mb-6">
              <button onClick={() => setIsLogin(true)} className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${isLogin ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"}`}>
                Đăng nhập
              </button>
              <button onClick={() => setIsLogin(false)} className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${!isLogin ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"}`}>
                Đăng ký
              </button>
            </div>

            {/* Rate Limit Warning */}
            {rateLimitError && <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm mb-4">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {rateLimitError}
              </div>}
            
            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-foreground">
                  ID người dùng
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input id="username" type="text" placeholder="Nhập ID của bạn" value={username} onChange={e => setUsername(e.target.value)} className={`pl-11 h-12 bg-background border-border focus:border-primary focus:ring-primary/20 ${errors.username ? "border-destructive" : ""}`} disabled={isLoading} autoComplete="username" />
                </div>
                {errors.username && <p className="text-sm text-destructive">{errors.username}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground">
                  Mật khẩu
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input id="password" type={showPassword ? "text" : "password"} placeholder="Nhập mật khẩu" value={password} onChange={e => setPassword(e.target.value)} className={`pl-11 pr-11 h-12 bg-background border-border focus:border-primary focus:ring-primary/20 ${errors.password ? "border-destructive" : ""}`} disabled={isLoading} autoComplete={isLogin ? "current-password" : "new-password"} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1}>
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
              </div>

              <Button type="submit" className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-medium" disabled={isLoading}>
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>
                    {isLogin ? "Đăng nhập" : "Tạo tài khoản"}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </>}
              </Button>
            </form>
          </div>

          {/* Security Note */}
          <div className="mt-6 text-center">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Lock className="w-3 h-3" />
              Mã hóa đầu cuối • Bảo mật tối đa
            </p>
          </div>
        </div>
      </div>
    </div>;
};
export default Auth;