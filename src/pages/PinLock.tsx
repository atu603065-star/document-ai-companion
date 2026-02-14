import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSecurePIN } from "@/hooks/useSecurePIN";
import { secureSessionStorage } from "@/lib/security";
import { Shield, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

const PinLock = () => {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { getPinStatus, verifyPin } = useSecurePIN();

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        navigate("/auth");
        return;
      }

      // Check if already verified in this session
      const verified = secureSessionStorage.get("pin_verified");
      if (verified === "true") {
        navigate("/chat");
        return;
      }

      // Fetch PIN status using secure function
      const status = await getPinStatus();

      if (!status?.pin_enabled) {
        // No PIN required
        secureSessionStorage.set("pin_verified", "true");
        navigate("/chat");
        return;
      }

      if (status.is_locked && status.locked_until) {
        setIsLocked(true);
        setLockedUntil(status.locked_until);
      }

      setPinRequired(true);
      setLoading(false);
    };

    checkAuth();
  }, [navigate, getPinStatus]);

  const handleVerify = async () => {
    if (pin.length !== 6) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Vui lòng nhập đủ 6 số",
      });
      return;
    }

    if (isLocked) {
      toast({
        variant: "destructive",
        title: "Tài khoản bị khóa",
        description: "Vui lòng thử lại sau",
      });
      return;
    }

    setVerifying(true);

    // Verify PIN using secure server-side function
    const result = await verifyPin(pin);

    if (result.success) {
      secureSessionStorage.set("pin_verified", "true");
      navigate("/chat");
    } else {
      setPin("");
      
      if (result.locked_until) {
        setIsLocked(true);
        setLockedUntil(result.locked_until);
        toast({
          variant: "destructive",
          title: "Tài khoản bị khóa",
          description: "Quá nhiều lần thử sai. Vui lòng thử lại sau 30 phút.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Sai mật mã",
          description: result.attempts_remaining !== undefined 
            ? `Còn ${result.attempts_remaining} lần thử`
            : result.message,
        });

        // If no attempts remaining, logout
        if (result.attempts_remaining === 0) {
          await supabase.auth.signOut();
          secureSessionStorage.clear();
          navigate("/auth");
        }
      }
    }

    setVerifying(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    secureSessionStorage.clear();
    navigate("/auth");
  };

  const formatLockedTime = (lockedUntilStr: string) => {
    const lockedDate = new Date(lockedUntilStr);
    const now = new Date();
    const diffMs = lockedDate.getTime() - now.getTime();
    const diffMins = Math.ceil(diffMs / 60000);
    
    if (diffMins <= 0) {
      setIsLocked(false);
      setLockedUntil(null);
      return "";
    }
    
    return `${diffMins} phút`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">SecureChat</h1>
          <p className="text-muted-foreground mt-2">
            {isLocked 
              ? "Tài khoản đang bị khóa tạm thời"
              : "Nhập mật mã 6 số để tiếp tục"
            }
          </p>
        </div>

        {isLocked && lockedUntil ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center">
            <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-2" />
            <p className="text-destructive font-medium">
              Quá nhiều lần thử sai
            </p>
            <p className="text-muted-foreground text-sm mt-1">
              Thử lại sau {formatLockedTime(lockedUntil)}
            </p>
          </div>
        ) : (
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={pin}
              onChange={setPin}
              onComplete={handleVerify}
              disabled={verifying}
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
        )}

        <div className="space-y-3">
          {!isLocked && (
            <Button
              className="w-full"
              onClick={handleVerify}
              disabled={pin.length !== 6 || verifying}
            >
              {verifying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Xác nhận"
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={handleLogout}
          >
            Đăng xuất
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PinLock;
