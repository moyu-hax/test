import os
import re
import sys
import time
import platform
import requests

from pyvirtualdisplay import Display
from seleniumbase import SB


LOGIN_URL = "https://idc-new.ulzix.com/login"
SIGNIN_URL = "https://idc-new.ulzix.com/pointmall/signin"
SS_DIR = "screenshots"


def log(level, msg):
    print(f"[{level}] {msg}")


def send_tg_photo(token, chat_id, path, caption=""):
    if not (token and chat_id and os.path.exists(path)):
        return

    try:
        with open(path, "rb") as f:
            requests.post(
                f"https://api.telegram.org/bot{token}/sendPhoto",
                files={"photo": f},
                data={"chat_id": chat_id, "caption": caption},
                timeout=30,
            )
        log("INFO", "Telegram 截图发送成功")
    except Exception as e:
        log("ERROR", f"Telegram 截图发送失败: {e}")


def screenshot(sb, name):
    os.makedirs(SS_DIR, exist_ok=True)
    path = os.path.join(SS_DIR, f"{name}.png")
    try:
        sb.save_screenshot(path)
        log("INFO", f"截图: {name}")
        return path
    except Exception as e:
        log("ERROR", f"截图失败 ({name}): {e}")
        return ""


def dump_html(sb, name):
    os.makedirs(SS_DIR, exist_ok=True)
    try:
        with open(os.path.join(SS_DIR, f"{name}.html"), "w", encoding="utf-8") as f:
            f.write(sb.get_page_source())
    except Exception:
        pass


def finish(sb, tg_token, tg_chat_id, name, caption):
    dump_html(sb, name)
    img = screenshot(sb, name)
    if img:
        send_tg_photo(tg_token, tg_chat_id, img, caption)


def parse_account(raw):
    value = (raw or "").strip()
    index = value.find(":")
    if index <= 0 or index == len(value) - 1:
        raise ValueError("ACCOUNTS 格式错误，应为 邮箱:密码")
    return value[:index].strip(), value[index + 1 :].strip()


def is_signed(html):
    # ✅ 1. 页面明确显示“今日已签到”
    if "今日已签到" in html:
        return True

    # ✅ 2. 按钮已签到状态（你HTML里真实存在）
    if "btn btn-success" in html and "已签到" in html:
        return True

    # ✅ 3. 禁用按钮（已签到特征）
    if "disabled" in html and "已签到" in html:
        return True

    # ❌ 未签到按钮通常是可点击
    if "立即签到" in html or "btn-signin" in html:
        return False

    # ✅ 4. fallback：积分区域存在但不关键
    if "签到记录" in html:
        return True

    return False


def extract_points(html):
    match = re.search(r'data-points="(\d+)"', html)
    return match.group(1) if match else "未知"


def build_result_caption(account, result_text, before_points=None, current_points=None, fail_reason=None):
    lines = [
        "Ulzix 每日签到",
        f"🎮 账号：{account}",
        f"📊 签到结果: {result_text}",
    ]
    if before_points is not None:
        lines.append(f"🎉 签到前积分: {before_points}")
    if current_points is not None:
        lines.append(f"💰 当前积分: {current_points}")
    if fail_reason:
        lines.append(f"❌ 失败原因: {fail_reason}")
    return "\n".join(lines)


def handle_turnstile(sb, scene="page", max_attempts=3):
    log("INFO", f"[{scene}] 开始处理 Turnstile 验证")
    sb.execute_script("window.scrollTo(0, document.body.scrollHeight);")
    time.sleep(2)

    for attempt in range(max_attempts):
        log("INFO", f"[{scene}] Turnstile 尝试 {attempt + 1}/{max_attempts}")
        try:
            #sb.uc_gui_click_captcha()
            #log("INFO", f"[{scene}] 已调用 uc_gui_click_captcha")
            sb.uc_gui_handle_captcha()
            log("INFO", f"[{scene}] 已调用 uc_gui_handle_captcha")
        except Exception as e:
            log("WARN", f"[{scene}] uc_gui_click_captcha 失败: {e}")

        start = time.time()
        while time.time() - start < 20:
            token_ready = sb.execute_script(
                """
                var inp = document.querySelector('input[name="cf-turnstile-response"]');
                return !!(inp && inp.value && inp.value.length > 20);
                """
            )
            if token_ready:
                log("INFO", f"[{scene}] ✅ Turnstile 通过")
                screenshot(sb, f"turnstile_ok_{scene}")
                return True

            success = sb.execute_script(
                """
                var el = document.getElementById('success');
                return el && getComputedStyle(el).display !== 'none';
                """
            )
            if success:
                log("INFO", f"[{scene}] Turnstile 显示成功元素")
                return True
            time.sleep(1)

        log("WARN", f"[{scene}] 当前尝试超时，重试...")
        sb.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(2)

    log("ERROR", f"[{scene}] Turnstile 验证失败")
    screenshot(sb, f"turnstile_fail_{scene}")
    return False


def login(sb, email, password):
    log("INFO", "打开登录页")
    sb.uc_open_with_reconnect(LOGIN_URL, reconnect_time=8)
    time.sleep(5)
    screenshot(sb, "01_login_loaded")

    sb.wait_for_element_visible("#email", timeout=15)

    log("INFO", f"填写邮箱: {email}")
    sb.click("#email")
    sb.clear("#email")
    sb.type("#email", email)
    time.sleep(0.5)

    sb.click("#password")
    sb.clear("#password")
    sb.type("#password", password)
    time.sleep(0.5)

    screenshot(sb, "02_form_filled")

    sb.wait_for_element_visible('button[type="submit"]', timeout=10)
    sb.click('button[type="submit"]')
    time.sleep(6)

    if "login" in sb.get_current_url().lower():
        log("ERROR", "登录失败，仍停留在登录页面")
        return False, "登录失败"

    log("INFO", "登录成功")
    screenshot(sb, "03_login_success")
    return True, None


def do_signin(sb):
    log("INFO", "打开签到页")
    sb.uc_open_with_reconnect(SIGNIN_URL, reconnect_time=8)
    time.sleep(5)
    screenshot(sb, "04_signin_loaded")

    sb.wait_for_element_visible("strong", timeout=10)

    initial_html = sb.get_page_source()
    before_points = extract_points(initial_html)
    if is_signed(initial_html):
        log("INFO", "今日已签到")
        return True, "今日已签到", before_points, before_points, None

    if not handle_turnstile(sb, "signin"):
        return False, "签到失败", before_points, before_points, "签到验证失败"

    btn = sb.find_element("//button[@id='btn-signin']", timeout=5)
    if not btn:
        log("ERROR", "找不到立即签到按钮")
        return False, "签到失败", before_points, before_points, "找不到签到按钮"

    btn.click()
    log("INFO", "已点击立即签到")
    time.sleep(3)

    for i in range(10):
        time.sleep(2)
        html = sb.get_page_source()
        if is_signed(html):
            current_points = extract_points(html)
            log("INFO", f"签到成功，积分: {current_points}")
            return True, "签到成功", before_points, current_points, None
        log("INFO", f"等待签到结果... ({i + 1})")

    current_points = extract_points(sb.get_page_source())
    log("WARN", "签到状态未确认")
    return False, "签到失败", before_points, current_points, "未确认签到状态"


def Ulzix_checkin():
    tg_token = os.getenv("TG_BOT_TOKEN")
    tg_chat_id = os.getenv("TG_CHAT_ID")
    account_raw = os.getenv("ACCOUNTS")
    if not account_raw:
        return False, "缺少 ACCOUNTS"

    try:
        email, password = parse_account(account_raw)
    except Exception as e:
        return False, str(e)

    display = None
    if platform.system().lower() == "linux" and not os.environ.get("DISPLAY"):
        try:
            display = Display(visible=False, size=(1280, 720))
            display.start()
            log("INFO", "虚拟显示已启动")
        except Exception as e:
            return False, f"虚拟显示失败: {e}"

    try:
        with SB(uc=True, test=True, locale="zh-CN", headless2=False) as sb:
            ok, reason = login(sb, email, password)
            if not ok:
                finish(
                    sb,
                    tg_token,
                    tg_chat_id,
                    "login_failed",
                    build_result_caption(email, "签到失败", fail_reason=reason),
                )
                return False, reason

            success, result_text, before_points, current_points, fail_reason = do_signin(sb)
            finish(
                sb,
                tg_token,
                tg_chat_id,
                "signin_ok" if success else "signin_fail",
                build_result_caption(email, result_text, before_points, current_points, fail_reason),
            )
            return success, result_text if success else fail_reason
    except Exception as e:
        log("ERROR", f"脚本异常: {e}")
        import traceback

        traceback.print_exc()
        return False, f"异常: {str(e)[:200]}"
    finally:
        if display:
            display.stop()


if __name__ == "__main__":
    ok, msg = Ulzix_checkin()
    log("INFO", msg)
    if not ok:
        sys.exit(1)
