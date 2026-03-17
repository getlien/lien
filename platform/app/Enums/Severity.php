<?php

namespace App\Enums;

enum Severity: string
{
    case Error = 'error';
    case Warning = 'warning';
    case Info = 'info';
    case None = 'none';
}
