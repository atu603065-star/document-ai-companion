import { Shield, MessageCircle, Lock, Zap } from "lucide-react";
export const EmptyState = () => {
  return <div className="flex-1 flex items-center justify-center bg-background p-8">
      <div className="text-center max-w-md animate-fade-in">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 mb-6">
          <Shield className="w-10 h-10 text-primary" />
        </div>
        
        <h2 className="text-2xl font-bold text-foreground mb-3">Chào mừng đến AnndChat</h2>
        <p className="text-muted-foreground mb-8">
          Chọn một cuộc trò chuyện hoặc bắt đầu cuộc trò chuyện mới để nhắn tin
        </p>

        <div className="grid gap-4 text-left">
          <div className="flex items-start gap-4 p-4 rounded-xl bg-card border border-border">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-medium text-foreground mb-1">Bảo mật tối đa</h3>
              <p className="text-sm text-muted-foreground">
                Mọi tin nhắn đều được mã hóa và bảo vệ
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 rounded-xl bg-card border border-border">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-medium text-foreground mb-1">Thời gian thực</h3>
              <p className="text-sm text-muted-foreground">
                Nhận tin nhắn ngay lập tức, không có độ trễ
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 rounded-xl bg-card border border-border">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-medium text-foreground mb-1">Chia sẻ file</h3>
              <p className="text-sm text-muted-foreground">
                Gửi ảnh, tài liệu và file an toàn
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>;
};