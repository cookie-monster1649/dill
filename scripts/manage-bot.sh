#!/bin/bash

# Dill Bot Management Script
# This script helps manage the Dill Bot process

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOCK_FILE="$PROJECT_DIR/.dill-bot.lock"
PID_FILE="$PROJECT_DIR/.dill-bot.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Function to get bot PID
get_bot_pid() {
    if [ -f "$LOCK_FILE" ]; then
        cat "$LOCK_FILE" 2>/dev/null
    else
        echo ""
    fi
}

# Function to check if bot is running
is_bot_running() {
    local pid=$(get_bot_pid)
    if [ -n "$pid" ]; then
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        else
            # Process is not running, clean up stale lock file
            rm -f "$LOCK_FILE"
            return 1
        fi
    fi
    return 1
}

# Function to start the bot
start_bot() {
    print_info "Starting Dill Bot..."
    
    if is_bot_running; then
        local pid=$(get_bot_pid)
        print_warning "Dill Bot is already running (PID: $pid)"
        return 1
    fi
    
    cd "$PROJECT_DIR"
    
    # Start the bot in the background
    nohup npm start > bot.log 2>&1 &
    local bot_pid=$!
    
    # Wait a moment for the bot to start
    sleep 3
    
    # Check if the bot started successfully
    if is_bot_running; then
        print_status "Dill Bot started successfully (PID: $bot_pid)"
        print_info "Logs are being written to: $PROJECT_DIR/bot.log"
        print_info "Health check available at: http://localhost:3000/health"
        return 0
    else
        print_error "Failed to start Dill Bot"
        print_info "Check the logs at: $PROJECT_DIR/bot.log"
        return 1
    fi
}

# Function to stop the bot
stop_bot() {
    print_info "Stopping Dill Bot..."
    
    if ! is_bot_running; then
        print_warning "Dill Bot is not running"
        return 0
    fi
    
    local pid=$(get_bot_pid)
    print_info "Sending SIGTERM to process $pid..."
    
    kill "$pid"
    
    # Wait for the process to stop
    local count=0
    while [ $count -lt 10 ] && is_bot_running; do
        sleep 1
        count=$((count + 1))
    done
    
    if is_bot_running; then
        print_warning "Bot didn't stop gracefully, sending SIGKILL..."
        kill -9 "$pid"
        sleep 1
    fi
    
    if ! is_bot_running; then
        print_status "Dill Bot stopped successfully"
        return 0
    else
        print_error "Failed to stop Dill Bot"
        return 1
    fi
}

# Function to restart the bot
restart_bot() {
    print_info "Restarting Dill Bot..."
    
    stop_bot
    sleep 2
    start_bot
}

# Function to check bot status
status_bot() {
    print_info "Checking Dill Bot status..."
    
    if is_bot_running; then
        local pid=$(get_bot_pid)
        print_status "Dill Bot is running (PID: $pid)"
        
        # Try to get health status
        if command -v curl >/dev/null 2>&1; then
            local health_response=$(curl -s http://localhost:3000/health 2>/dev/null)
            if [ -n "$health_response" ]; then
                print_info "Health check response:"
                echo "$health_response" | python3 -m json.tool 2>/dev/null || echo "$health_response"
            else
                print_warning "Health check endpoint not responding"
            fi
        else
            print_warning "curl not available - cannot check health endpoint"
        fi
        
        return 0
    else
        print_warning "Dill Bot is not running"
        return 1
    fi
}

# Function to show logs
show_logs() {
    local log_file="$PROJECT_DIR/bot.log"
    
    if [ -f "$log_file" ]; then
        print_info "Showing recent logs (last 50 lines):"
        tail -n 50 "$log_file"
    else
        print_warning "No log file found at: $log_file"
    fi
}

# Function to show help
show_help() {
    echo "Dill Bot Management Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  start     Start the Dill Bot"
    echo "  stop      Stop the Dill Bot"
    echo "  restart   Restart the Dill Bot"
    echo "  status    Check the status of the Dill Bot"
    echo "  logs      Show recent bot logs"
    echo "  help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 start"
    echo "  $0 status"
    echo "  $0 logs"
}

# Main script logic
case "${1:-help}" in
    start)
        start_bot
        ;;
    stop)
        stop_bot
        ;;
    restart)
        restart_bot
        ;;
    status)
        status_bot
        ;;
    logs)
        show_logs
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
