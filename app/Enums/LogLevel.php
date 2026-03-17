<?php

namespace App\Enums;

enum LogLevel: string
{
    case Info = 'info';
    case Warning = 'warning';
    case Error = 'error';
}
