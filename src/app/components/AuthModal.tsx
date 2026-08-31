import { useState, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useStorefrontPolicyPaths } from "../hooks/useStorefrontPolicyPaths";
import { X, Upload, User, Phone, Mail, Lock, Loader2, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "./ui/input-otp";
import { useLanguage } from "../contexts/LanguageContext";
import { compressImage } from "../../utils/imageCompression";
import { authApi } from "../../utils/api";
import { toast } from "sonner";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'login' | 'register';
  onModeChange: (mode: 'login' | 'register') => void;
  formData: {
    email: string;
    password: string;
    name: string;
    phone: string;
  };
  onFormChange: (field: string, value: string) => void;
  onLogin: () => Promise<void>;
  onRegister: (profileImage?: string, phoneVerificationToken?: string) => Promise<void>;
  isLoading: boolean;
}

export function AuthModal({
  isOpen,
  onClose,
  mode,
  onModeChange,
  formData,
  onFormChange,
  onLogin,
  onRegister,
  isLoading
}: AuthModalProps) {
  // 🔥 MUST call all hooks BEFORE any conditional returns (React Rules of Hooks)
  const navigate = useNavigate();
  const location = useLocation();
  const { termsPath, privacyPath } = useStorefrontPolicyPaths();
  const { t } = useLanguage();
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [registerStep, setRegisterStep] = useState<'form' | 'otp'>('form');
  const [otpCode, setOtpCode] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const resetRegisterFlow = useCallback(() => {
    setRegisterStep('form');
    setOtpCode('');
    setOtpSending(false);
    setIsVerifying(false);
    setResendCooldown(0);
  }, []);

  useEffect(() => {
    if (!isOpen || mode !== 'register') {
      resetRegisterFlow();
    }
  }, [isOpen, mode, resetRegisterFlow]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const sendPhoneOtp = async (): Promise<boolean> => {
    if (!formData.phone.trim()) {
      toast.error(t("storefront.auth.phoneRequired"));
      return false;
    }

    setOtpSending(true);
    try {
      const result = await authApi.sendRegisterPhoneOtp(formData.phone.trim());
      setResendCooldown(60);
      toast.success(result.message || t("storefront.auth.otpSent"));
      return true;
    } catch (error) {
      if (authApi.isPhoneOtpDisabledError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : t("storefront.auth.otpSendFailed");
      toast.error(message);
      return false;
    } finally {
      setOtpSending(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || otpSending) return;
    try {
      await sendPhoneOtp();
    } catch (error) {
      if (!authApi.isPhoneOtpDisabledError(error)) {
        const message = error instanceof Error ? error.message : t("storefront.auth.otpSendFailed");
        toast.error(message);
      }
    }
  };

  const getResetPasswordPath = (): string => {
    const parts = location.pathname.split("/").filter(Boolean);
    const currentPath = `${location.pathname}${location.search}${location.hash}`;
    const returnTo = `returnTo=${encodeURIComponent(currentPath)}`;

    if ((parts[0] === "store" || parts[0] === "vendor") && parts[1] && parts[1] !== "reset-password") {
      return `/${parts[0]}/${parts[1]}/reset-password?${returnTo}`;
    }
    return `/reset-password?${returnTo}`;
  };

  // Lock scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressedDataUrl = await compressImage(file, 500);
        setProfileImage(compressedDataUrl);
      } catch (error) {
        console.error('Image compression error:', error);
      }
    }
  };

  const removeImage = () => {
    setProfileImage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      await onLogin();
      return;
    }

    if (registerStep === 'form') {
      if (!formData.password || !formData.name || !formData.phone.trim()) {
        toast.error(t("storefront.account.registerRequiredFields"));
        return;
      }
      try {
        const sent = await sendPhoneOtp();
        if (sent) {
          setRegisterStep('otp');
          return;
        }
      } catch (error) {
        if (authApi.isPhoneOtpDisabledError(error)) {
          await onRegister(profileImage ?? undefined);
          return;
        }
        throw error;
      }
      return;
    }

    if (otpCode.trim().length !== 6) {
      toast.error(t("storefront.auth.otpRequired"));
      return;
    }

    setIsVerifying(true);
    try {
      const verifyResult = await authApi.verifyRegisterPhoneOtp(formData.phone.trim(), otpCode.trim());
      const token = verifyResult.phoneVerificationToken;
      if (!token) {
        throw new Error(t("storefront.auth.otpVerifyFailed"));
      }
      await onRegister(profileImage ?? undefined, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("storefront.auth.otpVerifyFailed");
      toast.error(message);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <Card className="w-full max-w-md shadow-2xl border-0 relative rounded-3xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-2 hover:bg-slate-100 rounded-full transition-colors z-10"
        >
          <X className="w-5 h-5 text-slate-600" />
        </button>

        <CardHeader className="pt-8 text-center">
          <CardTitle className="text-xl sm:text-2xl font-extrabold text-slate-900 mb-1">
            {mode === 'login'
              ? t("storefront.auth.welcome")
              : registerStep === 'otp'
                ? t("storefront.auth.verifyPhone")
                : t("storefront.auth.createAccount")}
          </CardTitle>
          <p className="text-xs sm:text-sm text-slate-500">
            {mode === 'login'
              ? t("storefront.auth.signInSubtitle")
              : registerStep === 'otp'
                ? t("storefront.auth.verifyPhoneSubtitle").replace("{phone}", formData.phone.trim())
                : t("storefront.auth.registerSubtitle").replace("{storeName}", "MIGOO")}
          </p>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'register' && registerStep === 'otp' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setRegisterStep('form');
                    setOtpCode('');
                  }}
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  {t("storefront.auth.backToDetails")}
                </button>

                <div className="space-y-3">
                  <Label className="text-slate-700 font-medium text-xs sm:text-sm">
                    {t("storefront.auth.enterOtp")}
                  </Label>
                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={6}
                      value={otpCode}
                      onChange={setOtpCode}
                      disabled={isLoading}
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
                  <p className="text-[11px] text-slate-500 text-center">
                    {t("storefront.auth.otpHint")}
                  </p>
                </div>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={resendCooldown > 0 || otpSending || isLoading}
                    className="text-xs text-slate-600 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {otpSending
                      ? t("storefront.auth.sendingOtp")
                      : resendCooldown > 0
                        ? t("storefront.auth.resendOtpIn").replace("{seconds}", String(resendCooldown))
                        : t("storefront.auth.resendOtp")}
                  </button>
                </div>
              </>
            )}

            {mode === 'register' && registerStep === 'form' && (
              <>
                {/* Profile Image Upload - Left Aligned Above Full Name */}
                <div className="flex justify-start mb-4">
                  <div className="relative">
                    {profileImage ? (
                      <div className="relative w-[100px] h-[100px]">
                        <img
                          src={profileImage}
                          alt="Profile"
                          className="w-full h-full object-cover rounded-lg border-2 border-slate-200"
                        />
                        <button
                          type="button"
                          onClick={removeImage}
                          className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1.5 transition-colors shadow-lg"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <label
                        htmlFor="profileImage"
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add('border-amber-500', 'bg-amber-50');
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.classList.remove('border-amber-500', 'bg-amber-50');
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove('border-amber-500', 'bg-amber-50');
                          const file = e.dataTransfer.files[0];
                          if (file && file.type.startsWith('image/')) {
                            const input = document.getElementById('profileImage') as HTMLInputElement;
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            input.files = dataTransfer.files;
                            handleImageUpload({ target: input } as any);
                          }
                        }}
                        className="flex flex-col items-center justify-center w-[100px] h-[100px] border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors"
                      >
                        <Upload className="w-6 h-6 sm:w-7 sm:h-7 text-slate-400 mb-1 sm:mb-1.5" />
                        <span className="text-[10px] sm:text-[11px] text-slate-500 text-center leading-tight px-1.5 sm:px-2 font-medium">
                          {t("storefront.auth.dragDropClick").split("\n").map((line, index) => (
                            <span key={line}>
                              {index > 0 && <br />}
                              {line}
                            </span>
                          ))}
                        </span>
                      </label>
                    )}
                    <input
                      id="profileImage"
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </div>
                </div>

                {/* Full Name Field */}
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-slate-700 font-medium text-xs sm:text-sm">
                    {t("storefront.auth.fullNameRequired")}
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                    <Input
                      id="name"
                      type="text"
                      placeholder={t("checkout.fullName.placeholder")}
                      className="pl-10 h-10 sm:h-11 text-sm"
                      value={formData.name}
                      onChange={(e) => onFormChange('name', e.target.value)}
                      required={mode === 'register'}
                    />
                  </div>
                </div>

                {/* Phone Number Field */}
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-slate-700 font-medium text-xs sm:text-sm">
                    {t("storefront.auth.phoneRequired")}
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder={t("storefront.auth.phonePlaceholder")}
                      className="pl-10 h-10 sm:h-11 text-sm"
                      value={formData.phone}
                      onChange={(e) => onFormChange('phone', e.target.value)}
                      required={mode === 'register'}
                      autoComplete="tel"
                      inputMode="tel"
                    />
                  </div>
                </div>

                {/* Email (optional on register) */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-700 font-medium text-xs sm:text-sm">
                    {t("storefront.auth.emailOptional")}
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      placeholder={t("storefront.auth.emailPlaceholder")}
                      className="pl-10 h-10 sm:h-11 text-sm"
                      value={formData.email}
                      onChange={(e) => onFormChange('email', e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {mode === 'login' && (
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-700 font-medium text-xs sm:text-sm">
                {t("storefront.auth.emailOrPhoneRequired")}
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                <Input
                  id="email"
                  type="text"
                  placeholder={t("storefront.auth.emailOrPhonePlaceholder")}
                  className="pl-10 h-10 sm:h-11 text-sm"
                  value={formData.email}
                  onChange={(e) => onFormChange('email', e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
            </div>
            )}

            {(mode === 'login' || (mode === 'register' && registerStep === 'form')) && (
            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-700 font-medium text-xs sm:text-sm">
                {t("storefront.auth.passwordRequired")}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t("auth.login.passwordPlaceholder")}
                  className="pl-10 h-10 sm:h-11 text-sm"
                  value={formData.password}
                  onChange={(e) => onFormChange('password', e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-400 cursor-pointer"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Eye className="w-4 h-4 sm:w-5 sm:h-5" />}
                </button>
              </div>
            </div>
            )}

            {mode === 'login' && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <Checkbox
                    checked={keepSignedIn}
                    onCheckedChange={(checked) => setKeepSignedIn(checked as boolean)}
                  />
                  <span className="text-xs text-slate-600 select-none">{t("storefront.auth.rememberMe")}</span>
                </label>
                <button 
                  type="button" 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('🔥🔥🔥 FORGOT PASSWORD CLICKED IN AUTHMODAL');
                    onClose(); // Close modal first
                    setTimeout(() => {
                      console.log('🔥🔥🔥 NAVIGATING TO RESET PASSWORD');
                      navigate(getResetPasswordPath());
                    }, 100);
                  }}
                  className="text-xs text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                >
                  {t("storefront.auth.forgotPassword")}
                </button>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 sm:h-12 bg-[#1a1d29] hover:bg-slate-900 text-white text-sm sm:text-base font-semibold rounded-full shadow-lg transition-colors"
              disabled={isLoading || otpSending || isVerifying}
            >
              {isLoading || otpSending || isVerifying ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  {mode === 'login'
                    ? t("storefront.auth.signingIn")
                    : registerStep === 'otp'
                      ? t("storefront.auth.creatingAccount")
                      : t("storefront.auth.sendingOtp")}
                </>
              ) : (
                mode === 'login'
                  ? t("auth.login.signIn")
                  : registerStep === 'otp'
                    ? t("storefront.auth.createAccount")
                    : t("storefront.auth.continueToVerify")
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs sm:text-sm text-slate-600">
              {mode === 'login' ? t("storefront.auth.dontHaveAccount") : t("storefront.auth.alreadyHaveAccount")}
              {' '}
              <button
                type="button"
                onClick={() => {
                  resetRegisterFlow();
                  onModeChange(mode === 'login' ? 'register' : 'login');
                }}
                className="text-xs sm:text-sm text-slate-900 hover:text-amber-600 font-bold transition-colors"
              >
                {mode === 'login' ? t("storefront.auth.signUp") : t("auth.login.signIn")}
              </button>
            </p>
          </div>

          {mode === 'register' && registerStep === 'form' && (
            <p className="text-[10px] sm:text-xs text-slate-600 text-center mt-4 leading-relaxed">
              {t("storefront.auth.termsPrefix")}{' '}
              <Link
                to={termsPath}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] sm:text-xs text-slate-900 hover:text-amber-600 font-bold transition-colors underline underline-offset-2"
              >
                {t("storefrontPolicy.termsTitle")}
              </Link>
              {' '}{t("storefront.auth.and")}{' '}
              <Link
                to={privacyPath}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] sm:text-xs text-slate-900 hover:text-amber-600 font-bold transition-colors underline underline-offset-2"
              >
                {t("storefrontPolicy.privacyTitle")}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}