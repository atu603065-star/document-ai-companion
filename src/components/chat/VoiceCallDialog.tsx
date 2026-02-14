import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  User,
  Loader2,
} from "lucide-react";

interface VoiceCallDialogProps {
  isOpen: boolean;
  isInCall: boolean;
  isCalling: boolean;
  isReceivingCall: boolean;
  participantName: string;
  participantAvatar?: string | null;
  isMuted: boolean;
  callDuration: string;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
}

export const VoiceCallDialog = ({
  isOpen,
  isInCall,
  isCalling,
  isReceivingCall,
  participantName,
  participantAvatar,
  isMuted,
  callDuration,
  onAccept,
  onReject,
  onEnd,
  onToggleMute,
}: VoiceCallDialogProps) => {
  const [pulseScale, setPulseScale] = useState(1);

  // Pulse animation for calling state
  useEffect(() => {
    if (isCalling || isReceivingCall) {
      const interval = setInterval(() => {
        setPulseScale(prev => prev === 1 ? 1.1 : 1);
      }, 600);
      return () => clearInterval(interval);
    }
    setPulseScale(1);
  }, [isCalling, isReceivingCall]);

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm bg-gradient-to-b from-card to-background border-border p-8 [&>button]:hidden shadow-2xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center gap-8">
          {/* Avatar with animated rings */}
          <div className="relative">
            {/* Outer animated rings */}
            {(isCalling || isReceivingCall || isInCall) && (
              <>
                <div className="absolute inset-0 w-32 h-32 -m-4 rounded-full border-4 border-primary/20 animate-ping" />
                <div 
                  className="absolute inset-0 w-28 h-28 -m-2 rounded-full border-2 border-primary/40 transition-transform duration-300"
                  style={{ transform: `scale(${pulseScale})` }}
                />
              </>
            )}
            
            <Avatar className="w-24 h-24 border-4 border-primary/30 shadow-lg relative z-10">
              <AvatarImage src={participantAvatar || undefined} className="object-cover" />
              <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-primary text-2xl font-semibold">
                {participantName?.charAt(0).toUpperCase() || <User className="w-12 h-12" />}
              </AvatarFallback>
            </Avatar>
            
            {/* Call status indicator */}
            {isInCall && (
              <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shadow-lg animate-pulse">
                <Phone className="w-4 h-4 text-white" />
              </div>
            )}
            {(isCalling || isReceivingCall) && (
              <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-lg">
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              </div>
            )}
          </div>

          {/* Name and Status */}
          <div className="text-center space-y-2">
            <h3 className="text-2xl font-bold text-foreground">{participantName}</h3>
            <p className="text-muted-foreground text-lg">
              {isReceivingCall && (
                <span className="flex items-center justify-center gap-2 animate-pulse text-primary">
                  <Phone className="w-4 h-4 animate-bounce" />
                  Cuộc gọi đến...
                </span>
              )}
              {isCalling && (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang kết nối...
                </span>
              )}
              {isInCall && (
                <span className="text-green-500 font-semibold text-xl tracking-wider">
                  {callDuration}
                </span>
              )}
            </p>
          </div>

          {/* Call Controls */}
          <div className="flex items-center gap-6 mt-4">
            {isReceivingCall && (
              <>
                <div className="flex flex-col items-center gap-2">
                  <Button
                    variant="destructive"
                    size="icon"
                    className="w-16 h-16 rounded-full shadow-lg hover:scale-110 transition-transform duration-200 bg-gradient-to-br from-red-500 to-red-600"
                    onClick={onReject}
                  >
                    <PhoneOff className="w-7 h-7" />
                  </Button>
                  <span className="text-xs text-muted-foreground">Từ chối</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <Button
                    size="icon"
                    className="w-16 h-16 rounded-full shadow-lg hover:scale-110 transition-transform duration-200 bg-gradient-to-br from-green-500 to-green-600 animate-bounce"
                    onClick={onAccept}
                  >
                    <Phone className="w-7 h-7" />
                  </Button>
                  <span className="text-xs text-muted-foreground">Trả lời</span>
                </div>
              </>
            )}

            {isCalling && (
              <div className="flex flex-col items-center gap-2">
                <Button
                  variant="destructive"
                  size="icon"
                  className="w-16 h-16 rounded-full shadow-lg hover:scale-110 transition-transform duration-200 bg-gradient-to-br from-red-500 to-red-600"
                  onClick={onEnd}
                >
                  <PhoneOff className="w-7 h-7" />
                </Button>
                <span className="text-xs text-muted-foreground">Huỷ</span>
              </div>
            )}

            {isInCall && (
              <>
                <div className="flex flex-col items-center gap-2">
                  <Button
                    variant={isMuted ? "destructive" : "secondary"}
                    size="icon"
                    className={`w-16 h-16 rounded-full shadow-lg hover:scale-110 transition-all duration-200 ${
                      isMuted 
                        ? "bg-gradient-to-br from-red-500 to-red-600" 
                        : "bg-gradient-to-br from-muted to-muted/80"
                    }`}
                    onClick={onToggleMute}
                  >
                    {isMuted ? (
                      <MicOff className="w-7 h-7" />
                    ) : (
                      <Mic className="w-7 h-7" />
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {isMuted ? "Bật mic" : "Tắt mic"}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <Button
                    variant="destructive"
                    size="icon"
                    className="w-16 h-16 rounded-full shadow-lg hover:scale-110 transition-transform duration-200 bg-gradient-to-br from-red-500 to-red-600"
                    onClick={onEnd}
                  >
                    <PhoneOff className="w-7 h-7" />
                  </Button>
                  <span className="text-xs text-muted-foreground">Kết thúc</span>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
